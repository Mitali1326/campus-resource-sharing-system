# Distributed Campus Resource Sharing & Real-Time Collaboration System

**Subject:** Distributed Systems (BCE27PC01) &nbsp;|&nbsp; **Covers:** Units 1, 2, 3 and 4 in one working system

Seven department servers (Computer, IT, Mechanical, Electrical, Civil, E&TC, Central Library) share labs, halls and
library rooms through one website. Each department is a **separate Docker container**.

The project is built so that **every concept of the syllabus is a feature that the campus system really uses**, in the same
way that WebRTC (Unit 2) is the video call and RPC (Unit 2) is booking:

| Concept (unit) | The feature of the system that uses it |
|---|---|
| RPC, pub/sub, WebRTC (2) | Booking, live notifications, chat, video call |
| Mutual exclusion (3) | Every booking takes a slot lock from the leader |
| Lamport and vector clocks (3) | `LC=n` tags on notifications; vector clock inside every chat message |
| Deadlock detection (3) | **Waiting list** for booked slots; circular waits are detected; a freed slot goes to the next waiter |
| Election, beacons, clock sync, snapshot (3) | **Cluster Operations** console (leader, heartbeats, clocks, campus snapshot) |
| Distributed objects (4) | **Details** panel of every resource (remote object reference) |
| REST, caching, CDN (4) | **Availability Board** |
| Distributed file system, MapReduce / Hadoop (4) | **Shared Files** with *Analyze keywords* |
| Distributed database trade-offs, CAP (4) | **Notice Board** with Strong / Balanced / Fast guarantees |
| Blockchain / ledger (4) | **Audit Trail** of every booking |
| Serverless (4) | **Reports** and the automatic booking-audit function |
| Kubernetes, AWS, Cloudflare, Megaport (4) | `k8s/campus.yaml`, EC2 deployment, edge caches, private network |

Other files in this folder:

| File | What it is |
|---|---|
| `PROJECT_DESCRIPTION.md` | One-page description you can read or hand over |
| `CONCEPTS_EXPLAINED.md` | Every syllabus topic explained from scratch + how this project implements it |
| `k8s/campus.yaml` | Kubernetes manifests (same 8 containers) |
| `scripts/smoke-test.js` | Automatic check of every feature (`npm run smoke`) |

---

## Contents

1. [Quick start (Docker)](#1-quick-start-docker)
2. [Run without Docker](#2-run-without-docker)
3. [Login passcodes](#3-login-passcodes)
4. [Feature guide: what each screen does](#4-feature-guide)
5. [Syllabus map and lab-assignment map](#5-syllabus-map-and-lab-assignment-map)
6. [Deploy on AWS EC2](#6-deploy-on-aws-ec2-part-d)
7. [Run on Kubernetes](#7-run-on-kubernetes-part-e)
8. [Demo script for the presentation (12 minutes)](#8-demo-script-12-minutes)
9. [Troubleshooting](#9-troubleshooting)
10. [Honest limitations](#10-honest-limitations)

---

## 1. Quick start (Docker)

**You need:** Docker Desktop installed and running (whale icon in the system tray). Check in a terminal: `docker --version`
and `docker compose version` must both print a version.

1. Unzip the project and open the folder `campus-ds-project` in VS Code (`File > Open Folder`).
2. Open the terminal in VS Code: `Terminal > New Terminal`. Make sure the prompt shows the project folder.
3. Start everything:
   ```
   docker compose up --build
   ```
   The first run takes a few minutes (it downloads Node and builds the image). Wait until you see
   `gateway | [gateway] listening on port 5000`. **Leave this terminal open.**
4. Open **http://localhost:5000** in Chrome/Edge/Firefox.
5. Sign in (passcodes in section 3), e.g. `Rohan`, Computer Engineering, `comp123`.
6. To stop: press `Ctrl + C` in the terminal, then run `docker compose down`.

Useful commands (open a **second** terminal in the same folder):

```
docker compose ps                 # the 8 containers and their state
docker stop mech-node             # kill one department (the failure demo)
docker start mech-node            # bring it back
docker compose logs -f gateway    # follow the gateway's log
```

> **Important:** a container that is stopped and started again loses its in-memory data (bookings, blocks, chat copy).
> That is intentional and is used in the demos (DFS re-replication, ledger "BEHIND", quorum read repair).

**Check that every feature works** (optional, needs Node.js 18+ on your PC). While the system is running, in a second terminal:

```
npm install
npm run smoke
```
It prints PASS / FAIL for 54 checks across every module of the system. Run it only on a freshly started system (it books
and cancels a few slots and writes one file to the file system).

## 2. Run without Docker

Needs Node.js 18 or newer (`node -v`). In the project folder:

```
npm install
npm start
```
This starts the gateway and the seven department nodes as eight Node processes; open http://localhost:5000.
`Ctrl + C` stops all of them. (Docker is the recommended way for the presentation, because stopping a *container*
is a much better failure demo than stopping a process.)

## 3. Login passcodes

| Department | Passcode |
|---|---|
| Computer Engineering | `comp123` |
| Information Technology | `it123` |
| Mechanical Engineering | `mech123` |
| Electrical Engineering | `elec123` |
| Civil Engineering | `civil123` |
| Electronics & Telecommunication | `entc123` |
| Central Library | `central123` |

This is a classroom login (checked in the browser) so every booking and chat message is tied to a department. It is
not production security.

---

## 4. Feature guide

The page has eight tabs named after what the system does. Each tab starts with a line **"Concepts used here"** that
lists the syllabus topics it demonstrates (grey = Units 1-2, blue = Unit 3, green = Unit 4). The department servers and the
current **LEADER** are shown at the top of every tab.

### 1. Booking & Collaboration

| Feature | How to try it | Concept | What happens inside |
|---|---|---|---|
| Book a time slot | Pick a department tab, click **Book** | RPC (2), mutual exclusion (3) | Browser -> gateway -> owning node by RPC. First the gateway takes that slot's **lock** from the leader, so two people can never get the same slot |
| Cross-department booking | As Computer, book a slot in the E&TC tab | Message-oriented (2) | Both departments' nodes automatically exchange a "booked / confirmed" chat message pair |
| Live notifications | Open the site in two browser tabs, book in one | Pub/sub (2), Lamport clock (3) | The other tab updates without refreshing. `LC=n` is the Lamport clock value of that event |
| Inter-department chat | Chat panel on the right | Message-oriented (2), vector clocks (3) | The message is stored in **two** nodes (sender's and receiver's); no shared chat table. The `VC` line under a bubble is the vector clock |
| Video call | **Start / Join Call** on a booked slot, in two tabs | WebRTC, P2P, stream-oriented (2), multimedia (1) | The gateway only relays the handshake; video goes browser to browser |
| **Waiting list** | Logged in as Computer, open a slot booked by another department and click **Join waiting list** | Deadlock detection (3) | Joining adds an edge "Computer waits for the holder" to the wait-for graph, and edge-chasing probes check at once whether a circle exists. When the holder **cancels**, the slot goes automatically to the first waiting department |
| **Deadlock alert** | Department A joins the list of B's slot while B is on the list of A's slot | Deadlock detection (3) | A red banner appears with **Resolve**, which cancels the weakest department's wait |
| **Details** | **Details** button on any resource | Distributed objects (4) | Calls `describe`, `utilization` and `availability` on the remote object `obj://<node>/<resource>` and shows the results |
| Login / failure | Sign in; `docker stop mech-node` | Unit 1 goals, fault tolerance | The department's pill turns red; the others keep working |

### 2. Availability Board

Read-only overview of every department's slots (green = free, amber = booked). *Concepts: distributed web-based systems, caching / CDN (4).*
Choose a **cache server** and press **Refresh board** twice: the first answer for a department is `MISS`, later ones are `HIT`, and the browser's
own `If-None-Match` request is answered `304` ("reused my copy"). Book something, refresh again: that department is `MISS` once more (the booking
**purged** the cache). The data comes from `GET /api/v1/departments/<dept>/resources?edge=<name>`.

### 3. Shared Files

Upload a text file (or use **Fill sample text**). *Concepts: distributed file system, MapReduce / Hadoop (4), fault tolerance (1).*
The file is cut into 160-character blocks and every block is stored on **3 departments**. **Read** shows which department served each block.
Stop one department (`docker stop comp-node`) and read again: the file is still readable. **Repair replicas** copies the lost blocks to
surviving departments. **Analyze keywords** runs a MapReduce word count: map tasks run on nodes that already hold the blocks, then a shuffle, then
reduce tasks, then the top words are shown.

### 4. Notice Board

Post a campus notice and choose a **write guarantee**. *Concepts: distributed database trade-offs, quorum, CAP (4).*
**Strong** = all 3 replicas must confirm, **Balanced** = 2 of 3, **Fast** = 1 of 3. Stop two containers and post with Strong (refused) and with Fast (accepted).
Reading uses a **read level** too; when write servers + read servers > 3, a read always returns the newest notice. Stale copies are repaired on read.

### 5. Audit Trail

Every booking and cancellation becomes a block in a hash-chained ledger mined by the leader. *Concepts: blockchain / distributed ledger (4), election (3).*
**Verify all copies** shows each department's own copy. Pick a "dishonest" department and press **Tamper**, then verify: it is flagged
**TAMPERED** and the other six outvote it. **Heal from majority** repairs it. A department that was down shows **BEHIND**.

### 6. Reports

Small serverless functions. *Concepts: serverless, event-driven functions, AWS Lambda (4).* Press **Run** on *Utilization report* twice: the first call is a **cold start**
(+300 ms), the second is warm. **Show usage & billing** lists calls and billed milliseconds (rounded up to 100 ms). `bookingAudit` runs by itself on every booking.
*Broadcast a notice* sends a message from Central Library to every department's chat.

### 7. Cluster Operations

The administrator's console, with one section per Unit 3 topic that is about the infrastructure itself. All of them act on the real containers.

| Section | Press | What you should see |
|---|---|---|
| Node health & heartbeats (beacon protocol) | open it, then `docker stop <dept>-node` | Nodes push a heartbeat every 3 s. A stopped node goes alive -> suspected (after 7 s) -> dead (after 15 s) by itself |
| Leader election (Bully, Ring) | "Run Bully", "Run Ring"; stop the leader's container and run again | The strongest live node wins. After `docker stop central-node` the leader becomes E&TC and the LEADER tag moves |
| Clock synchronization (Cristian, Berkeley) | "Show clock errors", "Run Cristian", "Make the clocks wrong again", "Run Berkeley" | Clocks start wrong by -2.4 s ... +3.1 s. Cristian puts every node on the gateway's time (error left <= about half the round trip). Berkeley puts every node on the *average* |
| Ordering of events (Lamport, vector clocks) | "Run the concurrent / happened-before demo" | Two independent events are **concurrent**; after a message, one **happened-before** the other |
| Campus state snapshot (global state) | "Take snapshot" (keep the box ticked) | Chandy-Lamport: markers, an **in-flight message** is captured, and every channel passes *sent - received = in flight* |
| Slot locks (mutual exclusion) | "3 departments book the same slot at the same instant"; "Ricart-Agrawala"; "Show lock log" | Exactly one booking succeeds; the leader's lock manager serves the others in arrival order. The demo picks a free slot and never touches real bookings |
| Deadlock monitor | "Create sample deadlock", "Detect", "Send probes", "Resolve", "Clear sample" | Shows who waits for whom **from the real waiting lists**. The sample makes two real bookings and two crossing waits; a department that only waits (not in the circle) is correctly **not** deadlocked |
| Edge cache statistics | "Show statistics" | HIT / MISS / 304 / purge counters of the Availability Board's cache servers |
| Platform & case studies | read the table | Kubernetes, AWS, Cloudflare, Megaport, Hadoop and where each appears in the project |

### 8. Syllabus Map

The mapping of every syllabus topic to a feature, inside the application, so you can show it during the presentation.

---

## 5. Syllabus map and lab-assignment map

### Syllabus (from the course document)

| Unit | Syllabus topic | Feature of the system that uses it | Main code |
|---|---|---|---|
| 1 | Definition, goals, types, architectures | 7 independent department servers behind one gateway; layered client-gateway-node design; P2P overlay for video | `docker-compose.yml`, `server/gateway.js` |
| 1 | Design issues, middleware | Gateway = middleware: naming, RPC forwarding, pub/sub, transparency | `server/gateway.js` |
| 1 | Distributed multimedia; virtualization (self study) | WebRTC video call; every node is a container | `public/app.js`, `Dockerfile` |
| 2 | RPC | Booking: JSON-RPC over HTTP from gateway to node | `server/nodes/createResourceNode.js` |
| 2 | Message-oriented, stream-oriented, P2P, WebRTC | Notifications, chat, video call | `server/gateway.js`, `public/app.js` |
| 2 | Names, identifiers, addresses; fault tolerance (self study) | `comp` (name) -> `comp-node` (id) -> URL (address) registry; stop any container | `server/shared/config.js` |
| 3 | Clock synchronization | Cluster Operations: Cristian, Berkeley | `services/unit3.js` section 2, `features/clocks.js` |
| 3 | Logical clocks, Lamport, vector algorithm | `LC=n` on notifications; vector clock in every chat message | `gateway.js`, `features/clocks.js` |
| 3 | Global state | Cluster Operations: Chandy-Lamport snapshot | `services/unit3.js` section 4, `features/snapshot.js` |
| 3 | Election algorithms | Bully elects the leader (lock manager, ledger miner); Ring also available | `services/unit3.js` section 5 |
| 3 | Mutual exclusion; Lodha-Kshemkalyani (self study) | Slot lock on every booking; Ricart-Agrawala simulation | `services/unit3.js` section 6, `features/locks.js` |
| 3 | Beacon protocol | Node health: heartbeats, suspected / dead | `features/beacon.js`, `services/unit3.js` section 1 |
| 3 | Deadlock detection; Knapp classification (self study) | Waiting list in Booking; wait-for graph + edge-chasing probes | `services/unit3.js` section 7, `gateway.js` (promotion) |
| 4 | Distributed object-based systems | Resource Details panel (remote object calls) | `features/objects.js`, `services/unit4.js` section 1 |
| 4 | Distributed web-based systems | Availability Board (REST + edge caches) | `services/unit4.js` section 2, `public/board.js` |
| 4 | Distributed file system | Shared Files (NameNode + 7 DataNodes, replication 3) | `services/unit4.js` section 3, `features/storage.js` |
| 4 | Serverless architectures | Reports (FaaS with cold starts, billing, event trigger) | `services/unit4.js` section 5, `services/functions.js` |
| 4 | Case studies: Megaport, Cloudflare, AWS, Hadoop, Kubernetes | Private network; edge caching; EC2 + Lambda-style reports; MapReduce keyword analysis; `k8s/campus.yaml` | Cluster Operations -> Platform, Parts 6 and 7 |
| 4 | Blockchain and distributed ledger (self study) | Audit Trail of every booking | `services/unit4.js` section 6, `features/ledger.js` |
| 4 | Trade-offs in distributed databases (self study) | Notice Board (quorum, N / W / R, CAP) | `services/unit4.js` section 7, `features/kvstore.js` |

### Suggested lab assignments (from the course document)

| Lab assignment | Where it is in the project |
|---|---|
| 1. Client-server using sockets / gRPC | Booking: browser <-> gateway <-> node RPC; Socket.IO sockets; the RPC trace panel |
| 2. Coordinator election (Bully / Ring) | Cluster Operations -> Leader election (the result drives the real lock manager) |
| 3. Deadlock detection (wait-for graph) | Waiting list in Booking + Cluster Operations -> Deadlock monitor |
| 4. Clock synchronization (Lamport or vector) | Notifications and chat (Lamport, vector) + Cluster Operations -> Ordering of events and Clock synchronization |
| 5. Word count using Hadoop (MapReduce on HDFS) | Shared Files -> Analyze keywords (same algorithm; HDFS and MapReduce are re-implemented, Hadoop itself is not used) |
| 6. Mini project: distributed application with Docker / Kubernetes, scalability and inter-service communication | The whole project; `docker-compose.yml`, `k8s/campus.yaml` |

### Project structure

```
campus-ds-project/
  server/
    gateway.js                  middleware: RPC, booking path (lock, notify, ledger), chat, signalling, leader
    services/unit3.js           synchronization: beacons, clock sync, vector clocks, snapshot, election, locks, waiting list + deadlock
    services/unit4.js           objects, REST + edge caches, file system, MapReduce, serverless, ledger, quorum notices
    services/functions.js       the serverless functions
    shared/config.js            department names, priorities, node addresses
    shared/ledgerUtil.js        hashing / proof-of-work for the ledger
    nodes/createResourceNode.js one department node (all 7 run this same code)
    nodes/features/*.js         node-side parts: clocks, beacon, snapshot, locks, objects, storage, ledger, kvstore
    nodes/compNode.js ...       the 7 department files (only name, port and resource list differ)
  public/                       the website: index.html, style.css, common.js, app.js (booking, chat, video, waiting list, details),
                                board.js, files.js, notices.js, audit.js, reports.js, ops.js, vendor/
  scripts/smoke-test.js         automatic feature check
  k8s/campus.yaml               Kubernetes manifests
  Dockerfile  docker-compose.yml  package.json
```

---

## 6. Deploy on AWS EC2 (Part D)

This runs exactly the same Docker setup on a virtual machine in AWS, so people can open it over the internet.

**Step 1 - Create the instance**

1. AWS Console -> search **EC2** -> **Launch instance**.
2. Name: `campus-ds`. OS image: **Ubuntu Server 22.04 LTS**.
3. Instance type: **t3.small** (2 GB RAM, recommended: eight Node containers plus the image build need more than 1 GB).
   A `t3.micro` / `t2.micro` also works if you add swap (see Troubleshooting).
4. Key pair: **Create new key pair**, type RSA, format `.pem`. Save the file - you cannot download it again.
5. Network settings -> **Edit** -> security group, inbound rules:
   - SSH, port 22, source **My IP**
   - Custom TCP, port **5000**, source **Anywhere (0.0.0.0/0)** (this is the website)
   - Do **not** open 5001-5007: only the gateway talks to the nodes, inside the private Docker network.
6. Storage: 16 GB is enough. **Launch instance**. Copy its **Public IPv4 address**.

**Step 2 - Connect** (from your own PC; replace the file name and IP)

Linux / macOS:
```
chmod 400 campus.pem
ssh -i campus.pem ubuntu@<PUBLIC-IP>
```
Windows PowerShell (the key file must be readable only by you, otherwise ssh refuses it):
```
icacls .\campus.pem /inheritance:r
icacls .\campus.pem /grant:r "$($env:USERNAME):(R)"
ssh -i .\campus.pem ubuntu@<PUBLIC-IP>
```
Answer `yes` to the fingerprint question.

**Step 3 - Install Docker on the instance** (you are now inside the EC2 terminal)

```
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
sudo apt-get install -y unzip
exit
```
Connect again with the same `ssh` command (the group change needs a new login). Check: `docker compose version`.

**Step 4 - Copy the project** (run on your **own PC**, in the folder that contains the zip)

```
scp -i campus.pem campus-ds-project.zip ubuntu@<PUBLIC-IP>:~
```
(Windows: `scp -i .\campus.pem .\campus-ds-project.zip ubuntu@<PUBLIC-IP>:~`)

**Step 5 - Start it** (in the EC2 terminal)

```
unzip campus-ds-project.zip
cd campus-ds-project
docker compose up --build -d
docker compose ps
```
`-d` runs it in the background; it keeps running after you close the terminal and restarts after a reboot. All 8
containers should be `running`.

**Step 6 - Open it:** `http://<PUBLIC-IP>:5000`

**Step 7 - Camera / microphone on EC2 (important).** Browsers allow camera access only on `https://` pages or `localhost`.
Over plain `http://<PUBLIC-IP>:5000` the **video call will be blocked**; everything else works. For the demo either:
- in Chrome open `chrome://flags/#unsafely-treat-insecure-origin-as-secure`, set it to **Enabled**, type
  `http://<PUBLIC-IP>:5000` in the box, click **Relaunch** (do this on every PC that must use video), **or**
- show the video call on your laptop with `localhost:5000`, and use EC2 to show that the system runs in the cloud.

Video between two people on different networks uses the public Google STUN server; on some strict networks a TURN server
would also be needed (future work).

**Step 8 - Stop paying.** `docker compose down`, then in the EC2 console select the instance -> **Instance state** ->
**Terminate**. A stopped instance keeps its disk (small charge) and its public IP changes when it is started again.

**Demo on EC2:** from the EC2 terminal run `docker stop central-node` and refresh the website: the department turns red and
the LEADER tag moves. That is a real failure in a real cloud VM.

---

## 7. Run on Kubernetes (Part E)

`k8s/campus.yaml` defines the same 8 services as Kubernetes **Deployments** (keep the Pod alive) and **Services** (stable
DNS names such as `comp-node`). It uses the same image as Docker Compose.

> The manifests were checked for valid YAML structure, but they were not executed on a Kubernetes cluster while this
> project was prepared. Try them on your PC before the presentation; the cluster run is the optional extension.

**You need:** Docker Desktop, `kubectl`, and a local cluster (**minikube**, or Docker Desktop's built-in Kubernetes).

```
docker build -t campus-ds:latest .
minikube start
minikube image load campus-ds:latest        # makes the image visible inside the cluster
kubectl apply -f k8s/campus.yaml
kubectl get pods -n campus                  # wait until all 8 are Running (about 30 s)
kubectl port-forward -n campus svc/gateway 5000:5000
```
Open http://localhost:5000 (keep the port-forward terminal open). With Docker Desktop's Kubernetes in "kubeadm" mode the
image is already visible, so the `minikube` lines are not needed.

Demos:
```
kubectl delete pod -n campus -l app=mech-node     # Kubernetes recreates the pod by itself
kubectl get pods -n campus -w                     # watch it come back (Ctrl+C to stop watching)
kubectl delete -f k8s/campus.yaml                 # remove everything
```
Do **not** scale the gateway above 1 replica: its state (file metadata, caches) is in memory, so a second gateway would
have a different state. Nodes also hold their data in memory, which is why a recreated pod starts empty (the same as
`docker stop` / `docker start`).

---

## 8. Demo script (12 minutes)

Before you start: `docker compose up --build`, open the site in **two** browser tabs, sign in as Computer (tab 1) and
E&TC (tab 2). If you have Node.js, run `npm run smoke` once beforehand; if it prints `0 failed`, everything works.
Tell the audience once: "Every tab shows, in its first line, which syllabus concepts it uses."

| Min | Show | Say |
|---|---|---|
| 0-1 | Header: 7 department pills, the LEADER tag | "Seven independent servers, each in its own container, behave like one system. The strongest live server is the leader." |
| 1-3 | **Booking:** Computer books an E&TC slot; chat shows the automatic message pair and a vector clock; notification with `LC=n` appears in tab 2; RPC trace; **Details** on a resource | "RPC to the owning node, a lock so nobody double-books, pub/sub to everybody, two separate copies of the chat, logical clocks on the events, and every resource is a remote object." |
| 3-4 | **Waiting list:** E&TC joins the list of the slot Computer just booked; Computer cancels; the slot moves to E&TC. Then **Operations -> Deadlock monitor -> Create sample deadlock -> Detect -> Probes -> Resolve** | "A freed slot goes to the next waiter. If departments wait for each other in a circle, that is a deadlock - found by the wait-for graph and by edge-chasing probes - and we break it by aborting one victim." |
| 4-5 | **Operations -> Node health**, then `docker stop central-node` (wait ~10 s) and **Leader election** | "Heartbeats stop, the node becomes suspected then dead, and a new leader is elected - the lock manager moves with it." |
| 5-6 | **Operations -> Clock synchronization** (Cristian, then Berkeley); **Ordering of events**; **Campus state snapshot** | "Clocks disagree by seconds and are corrected; vector clocks tell concurrent from causal; the snapshot captures a message that was in flight." |
| 6-7 | **Availability Board** (HIT / 304) then book something and refresh (MISS) | "CDN-style edge cache with purge: the booking invalidated the cached copy." |
| 7-8 | **Shared Files:** upload, stop a node, read, **Analyze keywords** | "Replicated blocks keep the file readable; the word count runs where the blocks are, like Hadoop." |
| 8-9 | **Notice Board** with two containers stopped: post Strong, then Fast | "Consistency versus availability: the CAP trade-off, live." |
| 9-10 | **Audit Trail:** tamper, verify, heal | "One dishonest copy is outvoted by the majority." |
| 10-11 | **Reports:** run twice (cold, warm) and show billing | "Lambda-style serverless: cold start, billed milliseconds, and an event function that fires on every booking." |
| 11-12 | **Syllabus Map** tab, `k8s/campus.yaml`, EC2 | "Every unit is mapped to a working feature; the same containers run on Kubernetes and on AWS." |

After the demo bring everything back: `docker start central-node comp-node` (and any other node you stopped), then
**Audit Trail -> Heal from majority**.

---

## 9. Troubleshooting

| Problem | Fix |
|---|---|
| `docker : The term 'docker' is not recognized` | Docker Desktop is not installed or not running. Install it, start it, wait for the whale icon, open a **new** terminal |
| Docker Desktop shows "unexpected error ... vpnkit / mux" | Quit Docker Desktop, in an **Administrator** PowerShell run `wsl --shutdown`, start Docker Desktop again. If it persists: `wsl --update`, restart the PC |
| Page does not load at `localhost:5000` | Check `docker compose ps` (all `running`), use `http://` not `https://`, try `http://127.0.0.1:5000`, try a private window (extensions can block localhost) |
| Red bar "socket.io library did not load" | `public/vendor/socket.io.min.js` is missing - re-extract the zip and rebuild: `docker compose up --build` |
| Port already in use (5000-5007) | Another copy is running. `docker compose down`, or stop the `npm start` window |
| "Incorrect passcode" | Passcodes are case-sensitive (section 3) and the department in the drop-down must match |
| Chat history of a department fails to load | That department's container is stopped - expected. `docker start <name>-node` |
| Camera does not start | Click Allow when the browser asks; on EC2 see step 7 (needs the Chrome flag or `localhost`) |
| A Cluster Operations section says "Need at least 2 live nodes" | Too many containers are stopped. `docker compose ps`, then `docker start` them |
| Ledger shows BEHIND / TAMPERED | Expected after a restart or the tamper demo. Press **Heal from majority** |
| Everything is empty after a restart | Data is in memory by design (see limitations) |
| EC2 build is killed / very slow (1 GB RAM) | Add swap: `sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile`, then rerun `docker compose up --build -d` |
| `permission denied` for docker on EC2 | You skipped the log-out / log-in after `usermod`; `exit` and reconnect |

## 10. Honest limitations

Say these yourself before an examiner finds them; they show you understand the trade-offs.

- All data lives **in memory**: restarting a container empties it. Persistence (a database, volumes) is future work.
- The **gateway is a single point of failure** (it is also the NameNode, time server and snapshot initiator). The
  department nodes are not; the gateway is not replicated.
- Login passcodes are checked in the browser: a demo, not security. Serverless functions are fixed in the server and are
  not uploaded by users (Node's `vm` module is not a security boundary).
- The ledger is a teaching blockchain: small proof of work, one miner (the leader), no forks or incentives.
- Hadoop, gRPC and production Kubernetes are **not** used; HDFS-style storage, MapReduce and the RPC layer are small
  re-implementations of the same ideas so they can be demonstrated and explained line by line.
- Video uses STUN only; some networks need a TURN server.
- Ricart-Agrawala is a simulation. The slot lock, waiting list and deadlock detection, beacons, elections, clock sync, snapshot,
  file system, MapReduce, ledger, quorum notices and serverless runtime all act on the **real running containers**.
