# Concepts Explained From Scratch

For every syllabus topic: **what it means**, **an everyday picture**, **which feature of the campus system uses it**, and
**what to say in the viva**. Open the application while you read: the tab and button names below are the real ones.

## Quick index: concept -> feature

| Concept | Where you see it in the system |
|---|---|
| Resource sharing, middleware, transparency (1) | Whole system; the gateway |
| Distributed multimedia (1), WebRTC / P2P / streams (2) | Booking & Collaboration -> **Start / Join Call** |
| RPC (2) | Booking & Collaboration -> **Book**, RPC trace panel |
| Message-oriented communication (2) | Notifications and chat |
| Names, identifiers, addresses (2) | Department code -> node -> address registry |
| Mutual exclusion (3) | Every booking (slot lock); Cluster Operations -> Slot locks |
| Lamport / vector clocks (3) | `LC=n` tags; `VC` line in chat |
| Deadlock detection (3) | Booking -> **Join waiting list**; Cluster Operations -> Deadlock monitor |
| Beacon protocol (3) | Cluster Operations -> Node health & heartbeats |
| Election (3) | **LEADER** tag; Cluster Operations -> Leader election |
| Clock synchronization (3) | Cluster Operations -> Clock synchronization |
| Global state (3) | Cluster Operations -> Campus state snapshot |
| Distributed objects (4) | Booking -> **Details** |
| Web-based systems, caching, CDN (4) | **Availability Board** |
| Distributed file system, MapReduce / Hadoop (4) | **Shared Files** -> Analyze keywords |
| Serverless (4) | **Reports** |
| Blockchain (4) | **Audit Trail** |
| DB trade-offs, CAP, quorum (4) | **Notice Board** |
| Kubernetes, AWS, Cloudflare, Megaport (4) | `k8s/campus.yaml`, EC2, edge caches, private network |

---

## 0. The very basics

- **Process / server:** a running program. Here, eight Node.js programs run at the same time.
- **Container (Docker):** a sealed box that holds one program and everything it needs. Each box has its own files and its own
  crash: if one box stops, the others keep running.
- **Network message:** programs in different boxes cannot see each other's memory. The only way to cooperate is to send messages.
- **Distributed system:** several independent computers that cooperate by messages and look like **one** system to the user.
  Two facts make it hard: there is **no shared clock** and **no shared memory**, and parts can **fail independently**.

---

# UNIT 1 - Introduction

### Definition and goals
*Definition:* a collection of independent computers that appears to its users as a single coherent system (Tanenbaum).
*Goals:* **resource sharing**, **transparency**, **openness**, **scalability**, plus **fault tolerance**.
*In the system:* seven departments share labs and halls (resource sharing). The user never knows which container holds a
resource (location transparency). A new department means one small file and one container (scalability). HTTP, JSON and WebRTC
are open standards (openness). `docker stop mech-node` leaves the rest working (fault tolerance).
*Say:* "Users see one website; behind it are eight processes that can fail separately."

### Types of distributed systems
Distributed *computing* systems (clusters, grids), distributed *information* systems (transaction / business systems),
distributed *pervasive* systems (IoT). *Ours is a distributed information system* (booking = transactions on shared
resources); the video call is a small peer-to-peer system.

### Architectures
*Layered / client-server:* a client asks, a server answers. *Peer-to-peer:* every node is both. *In the system:* browser (client)
-> gateway -> department node (server) is layered client-server; the video call between two browsers is peer-to-peer. So it is a **hybrid**.

### Design issues
Heterogeneity, openness, security, scalability, failure handling, concurrency, transparency.
*In the system:* **concurrency** = two people booking the same slot (solved by the slot lock); **failure handling** = heartbeats and
leader election; **transparency** = the gateway hides addresses; **security** = the department login (simple).

### Middleware
Software between applications and the network that provides common services: naming, communication, security.
*In the system:* **the gateway is the middleware.** It looks up which node owns a resource (naming), forwards the call (RPC), takes the
lock, broadcasts the result (publish/subscribe) and records it in the audit trail. The browser never talks to a department node directly.

### Distributed multimedia systems
Systems that deliver audio/video that must arrive **continuously and on time**. *In the system:* the WebRTC video call.

### Self study: model of distributed computations, virtualization
*Model:* processes that only communicate by messages; events inside a process are ordered, events in different processes are ordered
only through messages (the idea behind Unit 3). *Virtualization:* running many isolated systems on one machine. *In the system:* every
node is a Docker container, and on AWS the whole thing runs on a virtual machine (EC2).

---

# UNIT 2 - Communication

### Fundamentals
Programs agree on a **protocol**. Three are used on purpose: HTTP for request/response, WebSocket (Socket.IO) for live events, WebRTC for real-time media.

### Remote Procedure Call (RPC)
*Idea:* call a function that runs on another computer as if it were local. *Picture:* phoning the department office and saying
"book Lab 1 for 3 pm". *In the system:* **Book** calls `bookResource`; the gateway packs `{method, params}` as JSON and POSTs it to the node's
`/rpc`; the node runs the procedure and returns JSON. The **RPC trace** panel shows each call and reply.
*Say:* "JSON-RPC over HTTP, the same idea as gRPC or Java RMI, but readable line by line."

### Message-oriented communication
*Idea:* send a message and carry on; the receiver handles it whenever it arrives (asynchronous, decoupled). *Picture:* a notice board.
*In the system:* after a booking the gateway **publishes** an event; every open browser that **subscribed** shows it instantly. The chat is
message-oriented too.

### Stream-oriented communication
*Idea:* a continuous flow of data where timing matters (audio, video). *In the system:* the live audio/video of a call.

### P2P messaging and WebRTC
*P2P:* two parties talk directly. *WebRTC:* a browser technology for direct audio/video/data. A server is needed only for the **handshake**
(offer, answer, network candidates). *In the system:* the gateway relays the handshake; Chrome's `chrome://webrtc-internals` proves the media
does not pass through the server.

### Self study: names, identifiers, addresses
*Name:* human-friendly (`comp`). *Identifier:* unique and permanent (`comp-node`). *Address:* where it is now (`http://comp-node:5001`).
A registry maps one to the other (`server/shared/config.js`), so addresses can change (localhost, Docker DNS, Kubernetes Service, EC2)
without changing the application.

### Self study: fault tolerance
Hide or survive failures. *In the system:* independent containers; clear errors when a node is down; replication of files and notices (Unit 4).

---

# UNIT 3 - Synchronization

**Why it exists:** computers have different clocks and no shared memory, so we need algorithms to agree on time, order events, share things
safely, pick leaders, take consistent pictures and detect stuck systems.

### Mutual exclusion
*Problem:* only one process may use a shared thing at a time (the **critical section**). Booking one slot is a critical section.
- **Centralised:** one coordinator grants a lock; requests wait in a queue; 3 messages per entry (request, grant, release). Simple, but the
  coordinator is a bottleneck / single point of failure.
  *In the system this is **really used**:* every booking first obtains that slot's lock from the **leader**; if the leader changes, the new leader
  becomes the lock manager. *Try:* Cluster Operations -> Slot locks -> "3 departments book the same slot at the same instant": one wins, the others are
  served in order and rejected. The **lock log** shows GRANTED / RELEASED with Lamport clock values.
- **Ricart-Agrawala (distributed):** a process multicasts REQUEST(timestamp, id) and enters only after **all** reply. A process replies immediately
  unless it has an **earlier** request (smaller timestamp, ties by id) or is inside the critical section; then it **defers** the reply. `2(N-1)` messages
  per entry; requests are served in timestamp order, which is **fair**. *In the system:* a simulation with the full message log.
- **Self study - Lodha and Kshemkalyani's fair algorithm:** keeps the fairness of Ricart-Agrawala (served in the order requests were made, using
  logical clocks) and is designed to reduce the message overhead (check the paper for exact message counts before quoting numbers).

### Logical clocks - Lamport and vector
*Problem:* physical time cannot tell which event **caused** which. We only need the order of cause and effect.
- **Lamport clock:** one counter. Before an event increment; on receiving a message set `counter = max(own, received) + 1`. If A happened-before B then
  LC(A) < LC(B) (the reverse is **not** guaranteed). *In the system:* the `LC=n` tags on notifications, in the RPC trace and in the lock log.
- **Vector clock:** one counter **per node**. On receive: element-wise maximum, then increment your own entry. Compare two vectors: all entries <= and one <
  means *happened-before*; some bigger and some smaller means **concurrent** (a Lamport clock cannot detect that). *In the system:* every chat message
  carries one (the `VC` line under each bubble). *Try:* Cluster Operations -> Ordering of events.

### Deadlock detection
*Deadlock:* each of several processes holds something and waits for something held by the next one, in a circle, so none can move.
*Wait-for graph (WFG):* a node per process, an edge P -> Q when P waits for something Q holds. **A cycle = deadlock.**
*Knapp's classification (self study):* **path-pushing** (send whole paths), **edge-chasing** (send small probes), **diffusion computation**
(query-reply waves), **global state** (snapshot then analyse).
*In the system - the waiting list:* when a slot is taken, a department can **Join waiting list**. That adds the edge "my department waits for the
holder". If Computer waits for a slot Mechanical holds while Mechanical waits for a slot Computer holds, nobody will ever release anything: a deadlock.
The gateway checks this **at once** with **Chandy-Misra-Haas edge-chasing**: the new waiter sends PROBE(initiator, from, to) along its wait-for edges;
blocked receivers forward it; if the probe **comes back to the initiator**, it is deadlocked. A red banner offers **Resolve**, which aborts one **victim**
(the weakest department in the cycle) by cancelling its waiting request. A department that only waits (not in a circle) is never blamed.
When a holder **cancels**, the first department on the list receives the slot automatically.
*Try:* Cluster Operations -> Deadlock monitor -> Create sample deadlock (it makes two real bookings and two crossing waits).

### Beacon protocol
*Idea:* every node regularly **pushes** "I am alive". *Picture:* a lighthouse; silence means trouble. *In the system:* every 3 s each node POSTs a
beacon; no beacon for 7 s = *suspected*, 15 s = *dead*. This is different from the gateway **polling** a node (pull). A failure detector can be
wrong (a slow node looks dead), which is why there is a "suspected" state. *Try:* Cluster Operations -> Node health, then `docker stop mech-node`.

### Election algorithms
*Problem:* pick one coordinator, and pick a new one if it dies.
- **Bully:** the node that notices a missing coordinator sends ELECTION to all **higher**-id nodes. Any live higher node answers OK and takes over; the
  highest live id declares itself COORDINATOR.
- **Ring:** nodes sit in a logical ring; an ELECTION token collects ids; the highest id wins and a COORDINATOR message goes around.
*In the system:* the **leader** (highest-priority live node, shown as **LEADER**) is the **lock manager** for bookings and the **miner** of the audit trail.
Stop `central-node` and the leader changes by itself; the Operations buttons replay the message steps of both algorithms.

### Clock synchronization
*Problem:* two clocks never agree. *In the system:* each node's clock is wrong by a different amount (-2.4 s ... +3.1 s), which is exactly why the
system orders events with logical clocks instead of comparing node times.
- **Cristian:** ask a time server, measure the round-trip time (RTT), assume the reply took RTT/2 to come back: `server time = reply + RTT/2`. Accuracy is within about RTT/2.
- **Berkeley:** no trusted server. A master collects all clocks, **averages** them (ignoring wild outliers) and tells each node how much to move. Everyone ends on the *average*.
*Say:* "Cristian synchronizes to an external time server; Berkeley synchronizes the group with each other."

### Global state - Chandy-Lamport snapshot
*Problem:* record a consistent picture of all nodes **and** the messages travelling between them while the system keeps running.
*Picture:* photographing a busy road from many angles without stopping the cars. *Algorithm:* the initiator records its state and sends a **marker** on every
channel. A node that receives its first marker records its state and starts recording messages arriving on its other channels until their markers arrive;
those are the **in-flight** messages. *Check in the system:* for each channel, *sent - received (at the receiver's snapshot) = recorded in flight*.
The demo deliberately sends a chat message during the snapshot so you can see one captured. (Channels are assumed FIFO; the gateway relays in order.)

---

# UNIT 4 - Emerging Distributed Paradigms

### Distributed object-based systems
*Idea:* resources are **objects** with an interface (methods). A caller holds a **remote reference** and calls methods as if the object were local; a
**proxy/stub** on the client marshals the call into a message. Examples: **Java RMI, CORBA**.
*In the system:* every lab, hall and room is a remote object such as `obj://mech-node/mech-r2` with the interface
`describe, availability, utilization, book, cancel`. The **Details** button calls three of those methods and shows the reference, the hosting
container and the results. The gateway is the proxy. Booking through an object reference uses the same lock, notification and audit path as the Book button.

### Distributed web-based systems
*Idea:* the Web at scale: HTTP, REST, **caching**, **replication**, **CDNs**. *In the system - Availability Board:* a REST API
(`GET /api/v1/departments/mech/resources`) behind three **cache servers**. Headers show `X-Cache: MISS/HIT`, `Age`, `ETag`; `If-None-Match` returns
**304 Not Modified** when nothing changed (the board then reuses its own copy). A booking **purges** the cached copy so people do not see stale data -
the same problem and fix as in a CDN (Cloudflare).

### Distributed file system (HDFS idea)
*Idea:* one huge file system across many machines. Files are cut into **blocks**; every block is stored on several machines (**replication**). A
**NameNode** keeps only metadata (file -> blocks -> locations); **DataNodes** store the blocks.
*In the system - Shared Files:* the gateway is the NameNode, the seven departments are DataNodes, block size is tiny (160 characters) so even short text
becomes several blocks, replication factor is 3. Stop a node: the file is still readable. **Repair replicas** copies lost blocks to surviving nodes (like
HDFS re-replication when a DataNode dies).

### Apache Hadoop and MapReduce (case study, Lab assignment 5)
*MapReduce:* **map** turns each input piece into (key, value) pairs; **shuffle** groups equal keys and sends each group to one reducer; **reduce**
combines the values. Hadoop's key idea is **data locality**: send the computation to the machine that already holds the data.
*In the system - Analyze keywords:* word count over a shared file. Map tasks run on nodes that hold the blocks; partition = `hash(word) mod R`; reducers
add the counts. The result page lists which node ran what.

### Serverless architectures
*Idea:* you write small **stateless functions**; the platform runs them only when needed (HTTP call or **event**), scales them automatically and bills by
execution time. **Cold start:** the first call after idle needs a fresh runtime so it is slower.
*In the system - Reports:* four functions; `bookingAudit` runs automatically on every booking (event trigger). Run a report twice: first call shows
+300 ms (cold), second is warm. Billing rounds up to 100 ms (like AWS Lambda). Functions cannot keep state between calls.

### Case studies
- **Kubernetes:** an orchestrator that runs containers, restarts failed ones and gives stable names. *System:* `k8s/campus.yaml` (Deployments + Services);
  `kubectl delete pod` and watch it come back.
- **AWS:** EC2 (virtual machines), Lambda (serverless), S3/EBS (storage), Security Groups (firewall). *System:* deployed on EC2; Reports mirror Lambda; Shared Files mirror replicated cloud storage.
- **Cloudflare:** a global edge network that caches content near users. *System:* the Availability Board's cache servers.
- **Megaport:** software-defined, on-demand private connections between networks and clouds. *System:* the private network `campus-net` that joins the containers; only one port is public.
- **Hadoop:** HDFS + MapReduce (Shared Files).
*Be honest in the viva:* the project re-implements the ideas at small scale; it does not use the real products.

### Self study - Blockchain and distributed ledgers
*Idea:* an append-only list of **blocks**. Each block holds transactions, the **hash of the previous block** and a **nonce**. Changing an old block changes its
hash and breaks every later link, so tampering is detectable. **Proof of work:** finding a nonce so the hash starts with zeros makes adding blocks costly
(here three zeros). Copies are kept by many nodes and **consensus** decides which chain is right (here: the majority of valid copies).
*In the system - Audit Trail:* every booking/cancellation becomes a block mined by the leader; each department validates and keeps its own copy. **Tamper** edits an
old block in one department; **Verify** flags it TAMPERED (its hash no longer matches) and the six honest departments agree; **Heal** copies the majority chain
back. A department that was down shows **BEHIND**.

### Self study - Trade-offs in distributed databases
**CAP theorem:** when nodes or the network fail you must choose between **Consistency** (everyone sees the latest data) and **Availability** (every request
gets an answer); you cannot have both during a failure.
**Quorums:** keep N copies; a write needs W acknowledgements, a read asks R copies. **If W + R > N, a read always overlaps the latest write** (consistent).
Small W and R = fast and available but may return stale data (eventual consistency). **Read repair** fixes stale copies when they are noticed.
*In the system - Notice Board (N = 3):* **Strong** = W 3, **Balanced** = W 2, **Fast** = W 1. With two departments down, Strong is **refused** (consistency over
availability) and Fast is **accepted** (availability over consistency). Dynamo-style stores and Cassandra let you choose this per request.

---

## Glossary (one line each)

| Term | Meaning |
|---|---|
| Transparency | Hiding where things are, that they are replicated, or that they failed |
| Middleware | Software layer offering naming, communication and other common services |
| RPC | Calling a remote function like a local one |
| Pub/sub | Publishers send events; any number of subscribers receive them |
| Critical section | Code that only one process may run at a time |
| Waiting list | Queue of departments that want a slot someone else holds; its edges form the wait-for graph |
| Happened-before | Event A could have influenced event B |
| Concurrent | Neither event could have influenced the other |
| In-flight message | A message sent but not yet received at the moment of a snapshot |
| Quorum | The minimum number of replicas that must take part in an operation |
| Replication | Keeping copies of data on several nodes |
| Data locality | Running a computation on the node that already holds the data |
| Cold start | Extra delay when a serverless function runs after being idle |
| Consensus | Agreement of several nodes on one value (here: the ledger copy) |
