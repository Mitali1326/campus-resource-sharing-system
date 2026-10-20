# Project Description

**Title:** Distributed Campus Resource Sharing and Real-Time Collaboration System
**Subject:** Distributed Systems (BCE27PC01) - Mini Project covering Units 1, 2, 3 and 4
**Technology:** Node.js, Express, Socket.IO, WebRTC, Bootstrap, Docker / Docker Compose, Kubernetes manifests, AWS EC2

## 1. The problem

In an engineering college every department owns expensive resources: Mechanical has a 3D Printing Lab, Electrical has a
reference library, Computer has labs and a seminar hall, Civil has a concrete-testing lab. Students and staff of one
department regularly need the resources of another, but booking is done on paper, by phone or through one central
server that becomes a bottleneck and a single point of failure.

## 2. The solution

A web system in which **every department runs its own independent server (a Docker container)** that owns its resources and
its data. A **gateway** (middleware) presents all of them as one website. Students can book any department's lab or hall for
a time slot, wait for a slot that is taken, chat with the owning department, and start a live video session about the
booking. Shared files, campus notices, an audit trail and reports complete the system. If one department's server fails, the
other six keep working.

## 3. One system, not four demos

Each concept of the syllabus is a **feature the campus system actually needs**, the same way WebRTC is the video call:

| Concept (unit) | Feature that uses it |
|---|---|
| RPC, publish/subscribe, WebRTC, P2P (2) | Booking, live notifications, chat, video call |
| Mutual exclusion (3) | Every booking takes a slot lock from the elected leader |
| Lamport and vector clocks (3) | Event tags on notifications; vector clock in every chat message |
| Deadlock detection (3) | **Waiting list** for taken slots; circular waits are detected; a freed slot goes to the next waiter |
| Election, beacon protocol, clock synchronization, global state (3) | **Cluster Operations** console: leader, heartbeats, Cristian / Berkeley, snapshot |
| Distributed objects (4) | **Details** of every resource (remote object reference and method calls) |
| Web-based systems, caching, CDN (4) | **Availability Board** (REST API with edge caches) |
| Distributed file system, Hadoop MapReduce (4) | **Shared Files** with keyword analysis |
| Distributed database trade-offs, CAP (4) | **Notice Board** with Strong / Balanced / Fast guarantees |
| Blockchain, distributed ledger (4) | **Audit Trail** of all bookings |
| Serverless (4) | **Reports** and the automatic booking-audit function |
| Kubernetes, AWS, Cloudflare, Megaport (4) | `k8s/campus.yaml`, EC2 deployment, edge caches, private network |

## 4. Architecture in four lines

- **Browser** -> **Gateway** (middleware: naming, RPC forwarding, publish/subscribe, signalling) -> **7 department nodes**.
- Gateway-to-node communication is a Remote Procedure Call over HTTP/JSON; the nodes never share a database.
- Browsers learn about changes instantly through publish/subscribe; video goes **directly** browser to browser (WebRTC).
- All eight processes run as separate containers on a private network (`docker-compose.yml`, or `k8s/campus.yaml` on Kubernetes).

## 5. The screens

Booking & Collaboration - Availability Board - Shared Files - Notice Board - Audit Trail - Reports - Cluster Operations - Syllabus Map.
Every tab starts with a line listing the syllabus concepts it uses, so the examiner can see the mapping while the feature runs.

## 6. How it is demonstrated

Failure demos use `docker stop <department>-node`: the department turns red, a new leader is elected, files stay readable,
strict notices are refused while fast ones are accepted, the audit trail flags a tampered copy. An automatic test
(`npm run smoke`) checks 54 behaviours on the running system.

## 7. Outcomes

- All four course units appear in one working system instead of separate programs.
- The algorithms act on real, separately running containers, so failures are real, not drawn on screen.
- Covers all six suggested lab assignments (sockets / RPC, Bully / Ring, deadlock detection, Lamport / vector clocks,
  MapReduce word count, Docker / Kubernetes mini project).

## 8. Limitations and future scope

In-memory data (add a database and volumes); a single gateway (replicate it and elect a gateway leader); demo login (use real
authentication); toy blockchain; STUN-only video (add a TURN server); real Hadoop / gRPC could replace the small
re-implementations.

## 9. Pitch in 30 seconds

"Our college departments own different resources. We built a distributed system in which each department is its own server
in its own container, and a gateway makes them feel like one website. Booking uses RPC and a distributed lock; a waiting list
detects deadlocks; the leader is elected by the Bully algorithm and heartbeats detect failures. Shared files are replicated like
HDFS and analysed with MapReduce; notices live on a quorum of servers so we can show the CAP trade-off; every booking is written
to a blockchain-style audit trail; reports run as serverless functions. Everything runs in Docker, has Kubernetes manifests and
is deployed on AWS. Stop any server and the rest of the system keeps working."
