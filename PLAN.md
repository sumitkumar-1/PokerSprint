Act as a senior full-stack software architect, UI/UX designer, and DevOps engineer.

I want to build a standalone web-based Agile Planning Poker tool to estimate JIRA ticket story points in a corporate environment.

The application must be lightweight, real-time, session-based, and must NOT use a database. All state should be stored in-memory per session.

This tool will be used in a corporate environment, so it must be visually modern, attractive, and highly usable.

-----------------------------------
1. Architecture & Technology Stack
-----------------------------------

Backend:
- Node.js with Express
- Real-time communication using WebSockets (Socket.IO preferred)

Frontend:
- React (preferred)
- Modern component-based architecture
- Clean state management

State:
- In-memory only (no database)
- Support multiple rooms simultaneously

Deployment:
- Fully containerized using Docker
- Provide:
  - Production-ready Dockerfile
  - docker-compose.yml
- Must run using:
    docker-compose up --build
- Accessible at:
    http://localhost:3000

-----------------------------------
2. UI/UX Requirements (Very Important)
-----------------------------------

The UI must be:

- Modern and visually appealing
- Clean, minimalist corporate design
- Responsive (desktop-first but mobile-friendly)
- Smooth animations and transitions
- Professional color palette (neutral + accent color)
- Clear typography and spacing
- Intuitive and easy to use

Design expectations:
- Card-based layout
- Clear visual state indicators (Waiting, Voting, Revealed)
- Attractive voting cards (like real planning poker cards)
- Smooth reveal animation
- Clean participant list with status indicators
- Highlight current user
- Clear admin controls

Usability requirements:
- Extremely simple flow
- No clutter
- Clear feedback when voting
- Disabled states where appropriate
- Loading indicators
- Graceful error messages

Optional:
- Light/Dark mode toggle
- Subtle micro-interactions
- Timer visualization for voting

-----------------------------------
3. Core Features
-----------------------------------

A. Room Creation
- Scrum Master (Admin) creates a room.
- Unique room ID generated.
- Shareable URL (e.g., /room/{roomId}).

B. Join Room
- User must enter unique name.
- Display all participants in real-time.
- Show status: "Waiting for estimation to start".

C. Estimation Flow
- Admin clicks "Start Estimation".
- Users select story points from:
  Fibonacci: 1, 2, 3, 5, 8, 13, 21
  Optional: ?, ☕
- Votes remain hidden until Admin clicks "Reveal".
- After reveal:
  - Show all individual votes.
  - Show calculated average (ignore ?, ☕).
- Admin can click "Reset" for next round.

D. History (Session-level only)
- Maintain in-memory history per room.
- Show:
  - Round number
  - Individual votes
  - Average
- Clear history when server restarts.

-----------------------------------
4. State Model Example
-----------------------------------

rooms = {
  roomId: {
    adminId,
    participants: [
      { id, name, vote }
    ],
    status: "waiting" | "voting" | "revealed",
    history: []
  }
}

-----------------------------------
5. Edge Cases
-----------------------------------

- User refresh
- User disconnect
- Admin disconnect
- Duplicate names
- Late join during voting
- Empty room auto-cleanup

-----------------------------------
6. Non-Functional Requirements
-----------------------------------

- Clean folder structure
- Production-ready code
- Basic logging
- Error handling
- Environment variable support
- Health check endpoint
- Scalable room handling
- No database usage

-----------------------------------
7. Deliverables
-----------------------------------

Provide:

- Full backend code
- Full frontend code
- Folder structure
- Dockerfile
- docker-compose.yml
- README with setup instructions
- Clear comments explaining architectural decisions
- Optional enhancements if appropriate