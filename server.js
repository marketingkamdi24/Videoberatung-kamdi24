const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { ExpressPeerServer } = require('peer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);

// Socket.IO for real-time queue management
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// PeerJS Server
const peerServer = ExpressPeerServer(server, {
  debug: true,
  path: '/',
  allow_discovery: true
});

app.use('/peerjs', peerServer);
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Queue and Agent Management
const callQueue = [];
const agents = new Map(); // agentId -> { socketId, peerId, name, status: 'available' | 'busy' | 'offline', currentCall: null }
const activeCalls = new Map(); // callId -> { customerId, customerPeerId, agents: [], startTime, type }
const customers = new Map(); // customerId -> { socketId, peerId, status, queuePosition }

// API Routes
app.get('/api/queue', (req, res) => {
  res.json({
    queue: callQueue.map((c, i) => ({ ...c, position: i + 1 })),
    availableAgents: Array.from(agents.values()).filter(a => a.status === 'available').length
  });
});

app.get('/api/agents', (req, res) => {
  res.json(Array.from(agents.entries()).map(([id, agent]) => ({
    id,
    name: agent.name,
    status: agent.status,
    currentCall: agent.currentCall
  })));
});

// Socket.IO Events
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Customer joins queue
  socket.on('customer:join', (data) => {
    const customerId = uuidv4();
    const customer = {
      id: customerId,
      socketId: socket.id,
      peerId: data.peerId,
      name: data.name || 'Kunde',
      callType: data.callType || 'video', // 'video' or 'audio'
      hasVideo: data.hasVideo !== false,
      hasAudio: data.hasAudio !== false,
      joinedAt: new Date(),
      status: 'waiting'
    };
    
    customers.set(customerId, customer);
    callQueue.push(customer);
    
    socket.join('customers');
    socket.customerId = customerId;
    
    const position = callQueue.length;
    socket.emit('customer:queued', { customerId, position, estimatedWait: position * 3 });
    
    io.to('agents').emit('queue:updated', getQueueInfo());
    
    // Try to assign to available agent
    tryAssignCall();
  });

  // Customer cancels
  socket.on('customer:cancel', () => {
    if (socket.customerId) {
      removeCustomerFromQueue(socket.customerId);
      io.to('agents').emit('queue:updated', getQueueInfo());
    }
  });

  // Agent registers
  socket.on('agent:register', (data) => {
    const agentId = data.agentId || uuidv4();
    const agent = {
      id: agentId,
      socketId: socket.id,
      peerId: data.peerId,
      name: data.name || 'Mitarbeiter',
      status: 'available',
      currentCall: null
    };
    
    agents.set(agentId, agent);
    socket.join('agents');
    socket.agentId = agentId;
    
    socket.emit('agent:registered', { agentId, queue: getQueueInfo() });
    io.to('agents').emit('agents:updated', getAgentsInfo());
    
    // Try to assign waiting calls
    tryAssignCall();
  });

  // Agent changes status
  socket.on('agent:status', (data) => {
    if (socket.agentId && agents.has(socket.agentId)) {
      const agent = agents.get(socket.agentId);
      agent.status = data.status;
      agents.set(socket.agentId, agent);
      
      io.to('agents').emit('agents:updated', getAgentsInfo());
      
      if (data.status === 'available') {
        tryAssignCall();
      }
    }
  });

  // Agent accepts call
  socket.on('agent:accept', (data) => {
    const { customerId } = data;
    const customer = customers.get(customerId);
    const agent = agents.get(socket.agentId);
    
    if (customer && agent && agent.status === 'available') {
      const callId = uuidv4();
      
      // Update agent status
      agent.status = 'busy';
      agent.currentCall = callId;
      agents.set(socket.agentId, agent);
      
      // Update customer status
      customer.status = 'in-call';
      customers.set(customerId, customer);
      
      // Remove from queue
      const queueIndex = callQueue.findIndex(c => c.id === customerId);
      if (queueIndex > -1) {
        callQueue.splice(queueIndex, 1);
      }
      
      // Create active call
      activeCalls.set(callId, {
        id: callId,
        customerId,
        customerPeerId: customer.peerId,
        agents: [{ id: socket.agentId, peerId: agent.peerId }],
        startTime: new Date(),
        type: customer.callType
      });
      
      // Notify both parties
      socket.emit('call:start', {
        callId,
        customerPeerId: customer.peerId,
        customerName: customer.name,
        callType: customer.callType,
        customerHasVideo: customer.hasVideo,
        customerHasAudio: customer.hasAudio
      });
      
      const customerSocket = io.sockets.sockets.get(customer.socketId);
      if (customerSocket) {
        customerSocket.emit('call:connected', {
          callId,
          agentPeerId: agent.peerId,
          agentName: agent.name
        });
      }
      
      io.to('agents').emit('queue:updated', getQueueInfo());
      io.to('agents').emit('agents:updated', getAgentsInfo());
    }
  });

  // Add another agent to call (conference)
  socket.on('call:add-agent', (data) => {
    const { callId, targetAgentId } = data;
    const call = activeCalls.get(callId);
    const targetAgent = agents.get(targetAgentId);
    
    if (call && targetAgent && targetAgent.status === 'available') {
      targetAgent.status = 'busy';
      targetAgent.currentCall = callId;
      agents.set(targetAgentId, targetAgent);
      
      call.agents.push({ id: targetAgentId, peerId: targetAgent.peerId });
      activeCalls.set(callId, call);
      
      // Notify new agent
      const targetSocket = io.sockets.sockets.get(targetAgent.socketId);
      if (targetSocket) {
        targetSocket.emit('call:join', {
          callId,
          customerPeerId: call.customerPeerId,
          existingAgents: call.agents.filter(a => a.id !== targetAgentId).map(a => a.peerId),
          callType: call.type
        });
      }
      
      // Notify existing participants about new agent
      call.agents.forEach(a => {
        if (a.id !== targetAgentId) {
          const agentData = agents.get(a.id);
          if (agentData) {
            const agentSocket = io.sockets.sockets.get(agentData.socketId);
            if (agentSocket) {
              agentSocket.emit('call:agent-joined', {
                callId,
                newAgentPeerId: targetAgent.peerId,
                newAgentName: targetAgent.name
              });
            }
          }
        }
      });
      
      // Notify customer
      const customer = customers.get(call.customerId);
      if (customer) {
        const customerSocket = io.sockets.sockets.get(customer.socketId);
        if (customerSocket) {
          customerSocket.emit('call:agent-joined', {
            callId,
            newAgentPeerId: targetAgent.peerId,
            newAgentName: targetAgent.name
          });
        }
      }
      
      io.to('agents').emit('agents:updated', getAgentsInfo());
    }
  });

  // End call
  socket.on('call:end', (data) => {
    const { callId } = data;
    endCall(callId);
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    
    // Handle customer disconnect
    if (socket.customerId) {
      const customer = customers.get(socket.customerId);
      if (customer && customer.status === 'in-call') {
        // Find and end the call
        for (const [callId, call] of activeCalls.entries()) {
          if (call.customerId === socket.customerId) {
            endCall(callId);
            break;
          }
        }
      }
      removeCustomerFromQueue(socket.customerId);
      customers.delete(socket.customerId);
      io.to('agents').emit('queue:updated', getQueueInfo());
    }
    
    // Handle agent disconnect
    if (socket.agentId) {
      const agent = agents.get(socket.agentId);
      if (agent && agent.currentCall) {
        endCall(agent.currentCall);
      }
      agents.delete(socket.agentId);
      io.to('agents').emit('agents:updated', getAgentsInfo());
    }
  });
});

// Helper Functions
function getQueueInfo() {
  return {
    queue: callQueue.map((c, i) => ({
      id: c.id,
      name: c.name,
      callType: c.callType,
      position: i + 1,
      waitTime: Math.floor((new Date() - c.joinedAt) / 1000)
    })),
    total: callQueue.length
  };
}

function getAgentsInfo() {
  return Array.from(agents.entries()).map(([id, agent]) => ({
    id,
    name: agent.name,
    status: agent.status,
    peerId: agent.peerId
  }));
}

function removeCustomerFromQueue(customerId) {
  const index = callQueue.findIndex(c => c.id === customerId);
  if (index > -1) {
    callQueue.splice(index, 1);
    // Update queue positions for remaining customers
    callQueue.forEach((customer, i) => {
      const customerSocket = io.sockets.sockets.get(customer.socketId);
      if (customerSocket) {
        customerSocket.emit('queue:position', { position: i + 1 });
      }
    });
  }
}

function tryAssignCall() {
  if (callQueue.length === 0) return;
  
  const availableAgent = Array.from(agents.values()).find(a => a.status === 'available');
  if (!availableAgent) return;
  
  const nextCustomer = callQueue[0];
  
  // Notify agent about incoming call
  const agentSocket = io.sockets.sockets.get(availableAgent.socketId);
  if (agentSocket) {
    agentSocket.emit('call:incoming', {
      customerId: nextCustomer.id,
      customerName: nextCustomer.name,
      callType: nextCustomer.callType,
      waitTime: Math.floor((new Date() - nextCustomer.joinedAt) / 1000)
    });
  }
}

function endCall(callId) {
  const call = activeCalls.get(callId);
  if (!call) return;
  
  // Free up agents
  call.agents.forEach(a => {
    const agent = agents.get(a.id);
    if (agent) {
      agent.status = 'available';
      agent.currentCall = null;
      agents.set(a.id, agent);
      
      const agentSocket = io.sockets.sockets.get(agent.socketId);
      if (agentSocket) {
        agentSocket.emit('call:ended', { callId });
      }
    }
  });
  
  // Notify customer
  const customer = customers.get(call.customerId);
  if (customer) {
    const customerSocket = io.sockets.sockets.get(customer.socketId);
    if (customerSocket) {
      customerSocket.emit('call:ended', { callId });
    }
    customers.delete(call.customerId);
  }
  
  activeCalls.delete(callId);
  
  io.to('agents').emit('agents:updated', getAgentsInfo());
  
  // Try to assign next call
  tryAssignCall();
}

// Routes for pages
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'customer.html'));
});

app.get('/agent', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'agent.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Customer page: http://localhost:${PORT}`);
  console.log(`Agent dashboard: http://localhost:${PORT}/agent`);
});
