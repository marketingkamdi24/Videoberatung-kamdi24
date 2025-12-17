# kamdi24 Video & Voice Call Service

Ein Video- und Sprachanruf-Service für den kamdi24 Kundenservice mit Warteschlangen-Management und Multi-Party-Anruf-Unterstützung.

## Features

- **Video- und Sprachanrufe** direkt im Browser (keine Installation erforderlich)
- **Warteschlangen-System** für eingehende Kundenanrufe
- **Automatische Zuweisung** an verfügbare Mitarbeiter
- **Multi-Party-Anrufe** - mehrere Mitarbeiter können einem Gespräch beitreten
- **Echtzeit-Dashboard** für Mitarbeiter
- **Responsive Design** für Desktop und Mobile
- **Deutsche Benutzeroberfläche**

## Technologien

- **PeerJS** - WebRTC für Peer-to-Peer Video/Audio
- **Socket.IO** - Echtzeit-Kommunikation für Queue-Management
- **Express.js** - Web-Server
- **Node.js** - Backend-Runtime

## Installation & Start

### Setup (einmalig)
```bash
npm install
```

### Starten
```bash
npm start
```

Der Server startet auf Port 3000 (oder dem in `PORT` definierten Port).

## URLs

- **Kundenportal**: `http://localhost:3000/` - Hier können Kunden anrufen
- **Mitarbeiter-Dashboard**: `http://localhost:3000/agent` - Dashboard für Kundenservice-Mitarbeiter

## Deployment auf Render

1. Repository auf GitHub/GitLab pushen
2. Neuen Web Service auf [Render](https://render.com) erstellen
3. Repository verbinden
4. Render erkennt automatisch die `render.yaml` Konfiguration
5. Deploy starten

### Umgebungsvariablen (optional)

- `PORT` - Server-Port (Standard: 3000)
- `NODE_ENV` - Environment (production/development)

## Nutzung

### Für Kunden
1. Kundenportal öffnen (`/`)
2. Anruftyp wählen (Video oder Sprache)
3. "Jetzt anrufen" klicken
4. Kamera/Mikrofon-Zugriff erlauben
5. In der Warteschlange warten bis ein Mitarbeiter verfügbar ist

### Für Mitarbeiter
1. Mitarbeiter-Dashboard öffnen (`/agent`)
2. Namen eingeben und anmelden
3. Status auf "Verfügbar" setzen
4. Eingehende Anrufe werden automatisch zugewiesen
5. Anruf annehmen oder ablehnen
6. Optional: Kollegen zum Gespräch hinzufügen

## Architektur

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Kunde     │────▶│   Server    │◀────│  Mitarbeiter│
│  (Browser)  │     │  (Node.js)  │     │  (Browser)  │
└─────────────┘     └─────────────┘     └─────────────┘
       │                   │                   │
       │    PeerJS (WebRTC P2P)               │
       └──────────────────────────────────────┘
```

- **Socket.IO**: Signaling, Queue-Management, Status-Updates
- **PeerJS**: Direkte Video/Audio-Verbindung zwischen Teilnehmern

## Lizenz

Proprietär - kamdi24
