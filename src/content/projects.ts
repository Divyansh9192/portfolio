import type { LabRef, Project, ProjectSlug } from "./types";

// Every claim below is checked against the project's own repository.
// Facts cite repo-relative "path:line". Metrics say how they were counted.

const linkedin: Project = {
  slug: "linkedin-clone",
  name: "LinkedIn Clone",
  tagline: "Event-driven Spring Boot microservices",
  summary:
    "A LinkedIn-style backend split into six Spring Boot services behind a Spring Cloud Gateway. Posts and connection requests publish to Kafka, a notification service consumes them, and the connection graph lives in Neo4j.",
  headline: "6 services, 4 Kafka topics, 1 gateway that checks every token.",
  period: { label: "Jan 2026 – Feb 2026", start: "2026-01", end: "2026-02" },
  status: "complete",
  stack: ["Java", "Spring Boot", "Spring Cloud Gateway", "Eureka", "Apache Kafka", "Neo4j", "PostgreSQL", "OpenFeign", "Docker Compose"],
  links: { repo: "https://github.com/Divyansh9192/LinkedIn-Backend-System" },
  repoBranch: "main",
  image: { src: "/images/linkedin.png", alt: "LinkedIn clone feed screen on a desktop monitor", width: 1536, height: 1024 },
  metrics: [
    { value: "6", label: "Spring Boot services in Docker Compose", source: "services defined in docker-compose.yml" },
    { value: "4 × 3", label: "Kafka topics × partitions", source: "NewTopic beans in both KafkaTopicConfig classes" },
    { value: "9 of 11", label: "gateway-routed endpoints behind the JWT filter", source: "gateway routes with AuthenticationFilter, counted per controller" },
  ],
  system: {
    nodes: [
      { id: "client", label: "Client", kind: "client", tech: "HTTP", note: "Calls /api/v1/{users|posts|connections}/**" },
      { id: "gateway", label: "API Gateway", kind: "gateway", tech: "Spring Cloud Gateway + JJWT", note: "Validates the JWT once and forwards X-User-Id" },
      { id: "discovery", label: "Discovery", kind: "service", tech: "Netflix Eureka", note: "Service registry behind lb:// routes" },
      { id: "users", label: "user-service", kind: "service", tech: "Spring Boot + JPA", note: "Sign-up and login, issues JWTs" },
      { id: "posts", label: "posts-service", kind: "service", tech: "Spring Boot + JPA + Kafka", note: "Posts and likes" },
      { id: "connections", label: "connections-service", kind: "service", tech: "Spring Boot + Spring Data Neo4j", note: "Requests, accepts, first-degree graph" },
      { id: "kafka", label: "Kafka", kind: "broker", tech: "Apache Kafka (KRaft)", note: "4 topics × 3 partitions" },
      { id: "notifications", label: "notification-service", kind: "worker", tech: "Spring Boot + @KafkaListener", note: "Consumer group notification-service" },
      { id: "usersdb", label: "userDB", kind: "db", tech: "PostgreSQL 16" },
      { id: "postsdb", label: "postsDB", kind: "db", tech: "PostgreSQL 16" },
      { id: "neo4j", label: "Neo4j", kind: "db", tech: "Neo4j graph (:Person)" },
      { id: "notifdb", label: "notificationDB", kind: "db", tech: "PostgreSQL 16" },
    ],
    edges: [
      { from: "client", to: "gateway", protocol: "http", label: "/api/v1/**" },
      { from: "gateway", to: "users", protocol: "http", label: "/api/v1/users/** (no JWT filter)" },
      { from: "gateway", to: "posts", protocol: "http", label: "/api/v1/posts/** + X-User-Id" },
      { from: "gateway", to: "connections", protocol: "http", label: "/api/v1/connections/** + X-User-Id" },
      { from: "gateway", to: "discovery", protocol: "http", label: "resolve lb:// routes" },
      { from: "users", to: "usersdb", protocol: "sql", label: "users" },
      { from: "posts", to: "postsdb", protocol: "sql", label: "posts, posts_like" },
      { from: "connections", to: "neo4j", protocol: "cypher", label: "REQUESTED_TO / CONNECTED_TO" },
      { from: "posts", to: "kafka", protocol: "kafka", label: "post-created-topic, post-liked-topic" },
      { from: "connections", to: "kafka", protocol: "kafka", label: "send-/accept-connection-request-topic" },
      { from: "kafka", to: "notifications", protocol: "kafka", label: "4 @KafkaListener methods" },
      { from: "notifications", to: "connections", protocol: "feign", label: "GET /core/first-degree (per post-created event)" },
      { from: "notifications", to: "notifdb", protocol: "sql", label: "insert Notification" },
    ],
  },
  caseStudy: {
    intro:
      "I built this to learn what actually changes when one Spring Boot app becomes several: who owns which data, where identity gets checked, and what happens to an event when the service that should consume it is busy or down.",
    problem: [
      "A professional network has three different kinds of work hiding behind simple screens: transactional writes (sign-up, posts, likes), graph traversal (who is connected to whom), and fan-out (telling the right people that something happened).",
      "I split those into separately deployable services on purpose, so I would have to deal with the problems a monolith hides: no shared database, identity across service boundaries, and asynchronous delivery between services.",
    ],
    constraints: [
      "No shared database. user-service, posts-service and notification-service each own a PostgreSQL database, and connections-service owns a Neo4j graph. Nothing joins across them.",
      "Identity has to cross service boundaries without every service calling auth on every request.",
      "Notifications must not slow down the action that caused them. Creating a post or sending a connection request should return without waiting for anyone to be notified.",
      "Six services have to start, find each other and route correctly on one laptop.",
    ],
    architecture:
      "Every request enters through a Spring Cloud Gateway. For the posts and connections routes, its AuthenticationFilter validates the JWT once, then forwards the user's id downstream in an X-User-Id header, so the services behind it carry no JWT code at all. Routes resolve through a Eureka registry. posts-service publishes post-created and post-liked events, and connections-service publishes send- and accept-connection-request events, each to its own Kafka topic with three partitions. A single consumer group in notification-service listens to all four topics and writes notification rows to its own PostgreSQL database. Connections live in Neo4j as (:Person) nodes joined by REQUESTED_TO and CONNECTED_TO relationships.",
    decisions: [
      { kind: "choice", text: "Validate JWTs once at the gateway and pass a trusted X-User-Id header downstream. Services stay small and never call auth per request." },
      { kind: "tradeoff", text: "Services trust whatever X-User-Id they receive, so they must never be reachable except through the gateway. That boundary is a deployment rule, not something the code enforces." },
      { kind: "choice", text: "Publish domain events to Kafka instead of calling notification-service directly. A slow notification path cannot block creating a post or sending a request." },
      { kind: "tradeoff", text: "On every post-created event the consumer still makes a synchronous Feign call to connections-service to find who to notify. If connections-service is slow, consumer lag grows. Carrying the recipient list in the event, or caching the graph, would remove that coupling." },
      { kind: "choice", text: "Model connections in Neo4j: a request is a REQUESTED_TO edge, accepting it replaces that edge with CONNECTED_TO, and first-degree connections are a one-hop MATCH." },
      { kind: "tradeoff", text: "Two kinds of database (PostgreSQL and Neo4j) means two backup and monitoring stories for a small system. I accepted that to learn graph modelling properly." },
    ],
    result:
      "Six Spring Boot services, four Kafka topics and three PostgreSQL databases plus Neo4j, defined in Docker Compose and routed through Eureka and the gateway. It is the project I use to talk about service boundaries, identity at the edge and event delivery.",
    nextSteps: [
      "Add retries and a dead-letter topic to the notification consumer so a poison event cannot be lost or block a partition.",
      "Remove the synchronous Feign call from the post-created consumer by carrying recipients in the event.",
      "Add container health checks so Compose starts the services in dependency order without manual restarts.",
      "Finish the Kubernetes manifests (image names, ports and service discovery) so the cluster matches the Compose setup.",
    ],
  },
  lab: {
    slug: "kafka",
    title: "Kafka rebalance playground",
    blurb: "Publish real event types to the real topics, watch keys land on partitions, then kill a consumer or slow down connections-service and see lag build.",
    kind: "simulation",
  },
  facts: [
    { claim: "Four Kafka topics are declared: post-created-topic, post-liked-topic, send-connection-request-topic and accept-connection-request-topic, each with 3 partitions and replication factor 1.", evidence: "posts-service/src/main/java/com/divyansh/linkedin/posts_service/config/KafkaTopicConfig.java:12" },
    { claim: "The gateway's AuthenticationFilter rejects requests without a Bearer token and forwards the user id as an X-User-Id header.", evidence: "api-gateway/src/main/java/com/divyansh/linkedin/api_gateway/filters/AuthenticationFilter.java:30-45" },
    { claim: "notification-service consumes post-created-topic and calls connections-service over Feign to fetch first-degree connections before writing notifications.", evidence: "notification-service/src/main/java/com/divyansh/linkedin/notification_service/consumer/PostsServiceConsumer.java:23-31" },
    { claim: "First-degree connections are a one-hop Cypher MATCH on (:Person)-[:CONNECTED_TO]-(:Person).", evidence: "connections-service/src/main/java/com/divyansh/linkedin/connections_service/repository/PersonRepository.java:15-18" },
    { claim: "Accepting a request deletes the REQUESTED_TO relationship and creates CONNECTED_TO in one Cypher statement.", evidence: "connections-service/src/main/java/com/divyansh/linkedin/connections_service/repository/PersonRepository.java:41-45" },
    { claim: "JWTs issued by user-service expire after 100 minutes.", evidence: "user-service/src/main/java/com/divyansh/linkedin/user_service/service/JWTService.java:28" },
  ],
  tags: ["microservices", "event-driven", "kafka", "neo4j", "graph", "jwt", "gateway", "eureka", "spring cloud", "notifications", "java"],
};

const orchrez: Project = {
  slug: "orchrez",
  name: "Orchrez",
  tagline: "Durable multi-agent marketing workflows",
  summary:
    "A multi-tenant platform where LangGraph agents research a brand from its website, plan a month of content, write and illustrate every piece, wait for a human to approve, then publish. Runs are queued through RabbitMQ, checkpointed in PostgreSQL, streamed live over Server-Sent Events and paid for on a credit ledger.",
  headline: "Agent runs that pause for human approval and resume from a Postgres checkpoint.",
  period: { label: "Apr 2026 – May 2026", start: "2026-04", end: "2026-05" },
  status: "in-development",
  stack: ["Python", "FastAPI", "LangGraph", "Celery", "RabbitMQ", "PostgreSQL", "pgvector", "Redis", "Server-Sent Events", "Next.js", "Razorpay", "Docker Compose"],
  links: { repo: "https://github.com/Divyansh9192/Orchrez" },
  repoBranch: "frontend",
  image: { src: "/images/orchrez.png", alt: "Orchrez asset review and approval screen on a laptop", width: 2310, height: 1664 },
  metrics: [
    { value: "445", label: "backend tests (295 unit, 150 integration)", source: "test functions counted in backend/tests" },
    { value: "4 → 17 + 11", label: "LangGraph nodes: metagraph, research and execution subgraphs", source: "add_node calls in metagraph.py and both subgraph.py files" },
    { value: "33", label: "REST endpoints across 11 routers", source: "route decorators in backend/app/api/v1" },
    { value: "5", label: "durable RabbitMQ queues, including a dead-letter queue", source: "task_queues in backend/app/core/celery_app.py" },
  ],
  system: {
    nodes: [
      { id: "web", label: "Next.js dashboard", kind: "ui", tech: "Next.js 16, TanStack Query", note: "Starts runs, approves assets, follows progress live" },
      { id: "api", label: "FastAPI", kind: "service", tech: "FastAPI + SQLAlchemy", note: "33 endpoints, workspace-scoped auth, webhooks" },
      { id: "rabbitmq", label: "RabbitMQ", kind: "broker", tech: "RabbitMQ 4", note: "Durable queues: default, content, research, high, dlq" },
      { id: "worker", label: "Celery worker", kind: "worker", tech: "Celery prefork", note: "conductor_task, acks_late, prefetch 1" },
      { id: "beat", label: "Celery beat", kind: "worker", tech: "Celery beat", note: "Monthly pipeline trigger, DLQ reaper every 15 min" },
      { id: "graph", label: "LangGraph metagraph", kind: "service", tech: "LangGraph + PostgresSaver", note: "load_run_context → research → execution → persist_results" },
      { id: "postgres", label: "PostgreSQL", kind: "db", tech: "PostgreSQL 16 + pgvector", note: "Runs, run events, credit ledger, checkpoints, memory" },
      { id: "redis", label: "Redis", kind: "cache", tech: "Redis 7", note: "Celery results and SSE wake-ups" },
      { id: "firecrawl", label: "Firecrawl", kind: "external", tech: "Firecrawl API", note: "Crawls up to 40 pages of the brand's site" },
      { id: "llm", label: "LLM providers", kind: "external", tech: "OpenRouter, Gemini, Vertex AI", note: "Extraction, planning, copy and images" },
      { id: "publishers", label: "Publishers", kind: "external", tech: "LinkedIn, WordPress, Mailchimp", note: "Publishes approved assets" },
      { id: "razorpay", label: "Razorpay", kind: "external", tech: "Razorpay", note: "Top-ups and subscriptions" },
    ],
    edges: [
      { from: "web", to: "api", protocol: "http", label: "POST /v1/workflows/{name}/run" },
      { from: "api", to: "web", protocol: "sse", label: "GET /v1/runs/{id}/events (Last-Event-ID)" },
      { from: "api", to: "postgres", protocol: "sql", label: "workflow_runs + credit hold" },
      { from: "api", to: "rabbitmq", protocol: "amqp", label: "conductor_task → default" },
      { from: "beat", to: "rabbitmq", protocol: "amqp", label: "monthly_trigger, dlq_reaper" },
      { from: "rabbitmq", to: "worker", protocol: "amqp", label: "deliver task (acks_late)" },
      { from: "worker", to: "graph", protocol: "other", label: "graph.invoke(thread_id = run id)" },
      { from: "graph", to: "postgres", protocol: "sql", label: "checkpoints + run_events" },
      { from: "graph", to: "firecrawl", protocol: "http", label: "crawl brand site" },
      { from: "graph", to: "llm", protocol: "llm", label: "extract, plan, generate" },
      { from: "graph", to: "publishers", protocol: "http", label: "publish with idempotency key" },
      { from: "worker", to: "redis", protocol: "redis", label: "PUBLISH run_events:{id}" },
      { from: "api", to: "redis", protocol: "redis", label: "SUBSCRIBE wake-up" },
      { from: "razorpay", to: "api", protocol: "webhook", label: "POST /v1/webhooks/razorpay (HMAC)" },
    ],
  },
  caseStudy: {
    intro:
      "Orchrez turns a company's website into a month of on-brand marketing. It researches the brand, plans a content calendar, writes and illustrates each piece, waits for a person to approve, then publishes. The hard part is not any single model call. It is keeping a long, multi-step agent run correct while workers restart, people take hours to approve, and payment webhooks arrive more than once.",
    problem: [
      "A useful run is long: crawl the brand's site, extract positioning, audience and messaging, build a brand profile, plan a calendar, then generate copy and images for every entry. That is dozens of LLM calls and several external APIs, far too long for an HTTP request.",
      "It also needs a human in the middle. Teams want to approve, edit or reject assets before anything goes out, and that decision can come minutes or days later. The run has to stop, survive in the meantime, and continue exactly where it left off.",
    ],
    constraints: [
      "Runs outlive processes. Workers restart and approvals take hours, so run state cannot live in memory.",
      "Tenants share infrastructure. Every API route is scoped to the workspace in the caller's auth context.",
      "Credits must be counted once. They are held when a run starts and settled when it ends, and Razorpay can deliver the same webhook more than once.",
      "People should watch progress as it happens, without the browser polling a dozen endpoints.",
    ],
    architecture:
      "Starting a run inserts a workflow_runs row, places a credit hold on the ledger and enqueues conductor_task on RabbitMQ. A Celery worker (acks_late, prefetch 1) invokes a LangGraph metagraph with thread_id set to the run's id, so PostgresSaver checkpoints the run under that id; the subgraphs inherit the same checkpointer under their own namespaces. The metagraph routes load_run_context into a 17-node research subgraph (crawl, classify the business, extract positioning, audience, messaging and keywords, build the brand profile) and an 11-node execution subgraph (plan the content mix, generate the calendar, fan out one generator per entry with Send, generate images, approval gate, schedule, publish). persist_results then commits or releases the credits. The approval gate calls interrupt(), which parks the run in awaiting_approval; POST /approve flips it to resuming with a compare-and-set and re-enqueues the conductor with Command(resume=…). Workers write run events to Postgres and publish a wake-up on Redis. The dashboard follows them over Server-Sent Events, and the endpoint resumes from a Last-Event-ID cursor, so a client that reconnects catches up on what it missed.",
    decisions: [
      { kind: "choice", text: "Use the run's database id as the LangGraph thread_id. One identifier ties together the queue message, the checkpoint history, the run events and the credit hold." },
      { kind: "choice", text: "Pause for approval with LangGraph's interrupt() instead of ending the run and starting a new one. The graph's own state stays the source of truth for what was generated and what is waiting." },
      { kind: "choice", text: "Guard approval with a compare-and-set from awaiting_approval to resuming. A double-click or a retried request gets a 409 instead of resuming the run twice." },
      { kind: "choice", text: "Stream progress over Server-Sent Events that tail the run_events table, with Redis pub/sub used only as a wake-up. Events are durable in Postgres, so a client reconnecting with Last-Event-ID gets the events it missed." },
      { kind: "choice", text: "Keep credits on a ledger: hold when a run starts, commit on success, release on failure. Razorpay webhooks are deduplicated by a UNIQUE event id, and top-ups by a UNIQUE payment id." },
      { kind: "tradeoff", text: "One conductor task runs the whole graph up to the approval interrupt, so a run has to reach that point inside Celery's 20-minute soft time limit. The code to split runs into per-phase tasks on the research and content queues exists but is not switched on yet." },
      { kind: "tradeoff", text: "Tenant isolation is enforced in application code on every route rather than with Postgres row-level security. It is simpler to reason about, but it relies on every query carrying the workspace filter, so it depends on review and tests." },
    ],
    result:
      "The backend is built and tested: 445 test functions across unit and integration suites, 33 endpoints, three workflow types (full pipeline, research only, execution only), publishing to LinkedIn, WordPress and Mailchimp, and Razorpay billing on the credit ledger. The dashboard starts runs, streams their progress live and handles approvals. It is the project I point to first for agent orchestration, durable workflows and async pipelines.",
    nextSteps: [
      "Turn on per-phase tasks so research and execution run as separate jobs on their own queues, each with its own time limit.",
      "Serialise the balance check when placing a credit hold, so two runs started at once in the same workspace cannot overdraw.",
      "Make releasing credits consume the original hold, so a run that fails, resumes and fails again can only release once.",
      "Connect Clerk sign-in in the dashboard (the API already verifies Clerk JWTs) and finish the billing screens.",
      "Add publishers for X, Instagram and ads, which currently skip with a clear error.",
    ],
  },
  lab: {
    slug: "agent-queue",
    title: "Agent queue and checkpoint lab",
    blurb: "Push runs through RabbitMQ to a Celery pool, tune workers and retries, then crash a run mid-graph and watch it resume from its last checkpoint.",
    kind: "simulation",
  },
  facts: [
    { claim: "The metagraph has four nodes, load_run_context, research_subgraph, execution_subgraph and persist_results, with two conditional routers.", evidence: "backend/app/orchestrator/metagraph.py:283-305" },
    { claim: "The research subgraph registers 17 nodes, from receive_input and crawl_pages to build_brand_dna and validate_output.", evidence: "backend/app/agents/research/subgraph.py:51-67" },
    { claim: "The execution subgraph registers 11 nodes, including plan_content_mix, generate_calendar, approval_gate and publish_posts.", evidence: "backend/app/agents/execution/subgraph.py:69-79" },
    { claim: "The approval gate pauses the graph with interrupt() and a content_approval payload listing the assets to review.", evidence: "backend/app/agents/execution/nodes/approval.py:76-83" },
    { claim: "The conductor invokes the graph with thread_id set to the run id, so checkpoints are stored per run.", evidence: "backend/app/orchestrator/conductor.py:99" },
    { claim: "conductor_task runs with acks_late, reject_on_worker_lost, up to 3 retries 30 seconds apart, and a 20-minute soft time limit.", evidence: "backend/app/workers/tasks.py:21-31" },
    { claim: "Celery declares five durable queues: default, content, research, high and dlq, with worker_prefetch_multiplier 1.", evidence: "backend/app/core/celery_app.py:51-92" },
    { claim: "Runs move through queued, running, awaiting_approval, resuming, succeeded, failed and cancelled.", evidence: "backend/app/models/workflow.py:30-37" },
    { claim: "Razorpay webhooks are deduplicated by a UNIQUE event id; a duplicate returns 200 with status duplicate.", evidence: "backend/app/services/billing_service.py:184-210" },
    { claim: "Run progress streams over Server-Sent Events from GET /v1/runs/{run_id}/events, resuming from the Last-Event-ID cursor.", evidence: "backend/app/api/v1/events.py:88-170" },
    { claim: "A beat job, dlq_reaper, fails runs stuck in running for over 2 hours, records a dead_lettered event and releases their credits.", evidence: "backend/app/workers/tasks.py:367-419" },
    { claim: "Network and LLM steps in the research graph retry up to 3 times with exponential backoff and jitter.", evidence: "backend/app/agents/research/subgraph.py:43-44" },
    { claim: "Agent memory lives in memory_blocks with a 1536-dimension pgvector column and an HNSW cosine index.", evidence: "backend/alembic/versions/0001_init.py:254-259" },
    { claim: "A full pipeline run costs 10 credits, research only 3 and execution only 6.", evidence: "backend/app/api/v1/workflows.py:25-29" },
  ],
  tags: ["ai agents", "langgraph", "multi-agent", "durable workflows", "human in the loop", "checkpoints", "celery", "rabbitmq", "sse", "billing", "ledger", "idempotency", "multi-tenant", "python"],
};

const neonstays: Project = {
  slug: "neonstays",
  name: "NeonStays",
  tagline: "Hotel booking backend",
  summary:
    "A Spring Boot hotel booking API with inventory per room per night, row locks that stop two guests booking the last room, a decorator chain for dynamic pricing, and Stripe Checkout confirmed by a signed webhook.",
  headline: "35 endpoints, and inventory locked per room per night so the last room can't be sold twice.",
  period: { label: "Nov 2025 – Dec 2025", start: "2025-11", end: "2025-12" },
  status: "live",
  stack: ["Java 17", "Spring Boot 3.5", "Spring Security", "PostgreSQL", "Stripe", "Google OAuth2", "Swagger", "Docker"],
  links: { repo: "https://github.com/Divyansh9192/NeonStays-Backend", live: "https://neonstays.vercel.app" },
  repoBranch: "main",
  image: { src: "/images/neonstays.png", alt: "NeonStays landing page on a laptop", width: 1536, height: 1024 },
  metrics: [
    { value: "35", label: "REST endpoints across 10 controllers", source: "mapping annotations counted in the controller package" },
    { value: "5", label: "pricing strategies chained as decorators", source: "classes in the strategy package" },
    { value: "10 min", label: "reservation hold before payment", source: "hasBookingExpired in BookingServiceImpl" },
  ],
  system: {
    nodes: [
      { id: "web", label: "React frontend", kind: "ui", tech: "React on Vercel", note: "neonstays.vercel.app" },
      { id: "security", label: "Spring Security", kind: "gateway", tech: "JWT filter + OAuth2 login", note: "10-minute access token, 7-day refresh cookie" },
      { id: "api", label: "Booking API", kind: "service", tech: "Spring Boot 3.5", note: "Auth, hotels, rooms, inventory, search, bookings, payments" },
      { id: "pricing", label: "Pricing engine", kind: "service", tech: "Decorator chain", note: "base → surge → occupancy → urgency → holiday" },
      { id: "cron", label: "Pricing job", kind: "worker", tech: "@Scheduled, hourly", note: "Reprices every day for the next year" },
      { id: "postgres", label: "PostgreSQL", kind: "db", tech: "PostgreSQL via JPA", note: "One inventory row per room per night" },
      { id: "minprice", label: "HotelMinPrice", kind: "index", tech: "Read model table", note: "Daily minimum price per hotel, used by search" },
      { id: "stripe", label: "Stripe", kind: "external", tech: "Stripe Checkout", note: "Payment page, refunds, webhooks" },
      { id: "google", label: "Google", kind: "external", tech: "OAuth2", note: "Sign in with Google" },
    ],
    edges: [
      { from: "web", to: "security", protocol: "http", label: "REST /api/v1 + Bearer JWT" },
      { from: "security", to: "api", protocol: "other", label: "authenticated request" },
      { from: "security", to: "google", protocol: "http", label: "OAuth2 login" },
      { from: "api", to: "postgres", protocol: "sql", label: "SELECT … FOR UPDATE on inventory" },
      { from: "api", to: "pricing", protocol: "other", label: "price the stay" },
      { from: "api", to: "minprice", protocol: "sql", label: "search: AVG(price) by city and dates" },
      { from: "api", to: "stripe", protocol: "http", label: "create Checkout Session" },
      { from: "stripe", to: "api", protocol: "webhook", label: "checkout.session.completed (signed)" },
      { from: "cron", to: "pricing", protocol: "other", label: "reprice today → +1 year" },
      { from: "cron", to: "minprice", protocol: "sql", label: "upsert daily minimum" },
    ],
  },
  caseStudy: {
    intro:
      "NeonStays is a hotel booking backend. Booking looks like CRUD until two guests try to reserve the last room on the same night, a guest abandons checkout halfway, or prices need to move with demand. Those three problems shaped the design.",
    problem: [
      "Availability is per room, per night. A three-night stay touches three inventory rows, and every one of them must have space at the moment the booking is made, even when several requests race for the same room.",
      "Payment happens on Stripe's page, not in my API. The booking has to wait in a pending state until Stripe confirms the payment in a separate webhook call.",
    ],
    constraints: [
      "Two concurrent bookings must never both take the last room.",
      "A guest who abandons checkout must not hold rooms forever.",
      "Prices change with occupancy, lead time and manual surges, but search has to stay fast.",
      "Only Stripe's signed webhook can confirm a payment. The browser's success redirect proves nothing.",
    ],
    architecture:
      "Inventory is one row per hotel, room and date, with total, reserved and booked counts. Starting a booking locks the inventory rows for the stay's dates with a PESSIMISTIC_WRITE query (SELECT … FOR UPDATE), checks that each one has space, and increments reservedCount, which holds the rooms for 10 minutes. The booking then moves through RESERVED, GUEST_ADDED and PAYMENT_PENDING. Paying opens a Stripe Checkout Session whose id is saved on the booking. Stripe calls POST /api/v1/webhook/payment, the handler verifies the Stripe-Signature header, and on checkout.session.completed it finds the booking by session id, moves the reserved rooms to booked and marks it CONFIRMED. Prices come from a decorator chain (base → surge → occupancy → urgency → holiday) that an hourly job applies to every day for the next year, writing a daily minimum price per hotel that search reads instead of pricing every room per query.",
    decisions: [
      { kind: "choice", text: "Lock inventory rows with SELECT … FOR UPDATE while reserving. Concurrent bookings for the same room and dates wait on the lock instead of overbooking." },
      { kind: "tradeoff", text: "Row locks serialise bookings for a busy room. That is the right call for correctness at this scale; under heavy contention I would move to an atomic conditional UPDATE." },
      { kind: "choice", text: "Model pricing as a chain of small decorators. A new rule, such as a weekend surcharge, is one new class wrapping the others." },
      { kind: "choice", text: "Precompute prices hourly and keep a daily minimum price per hotel for search. Search reads one small table instead of pricing every room on every request." },
      { kind: "tradeoff", text: "Precomputed prices can be up to an hour old. A booking is priced from the stored nightly prices at the moment it is created, so what the guest sees is what they pay." },
      { kind: "choice", text: "Treat Stripe's signed webhook as the only proof of payment. The browser's redirect back to the site never confirms a booking." },
      { kind: "tradeoff", text: "The webhook handler confirms without recording which Stripe events it has already processed, so a redelivered event is handled again. The lab for this project shows what that means and how storing event ids fixes it." },
    ],
    result:
      "The API has 35 endpoints across 10 controllers: sign-up and login with JWTs and a 7-day refresh cookie, Google sign-in, hotel and room management, inventory controls, search, booking and payments, documented with Swagger. The frontend is deployed at neonstays.vercel.app.",
    nextSteps: [
      "Make the payment webhook idempotent: store processed Stripe event ids and require PAYMENT_PENDING before confirming.",
      "Expire abandoned holds with a scheduled job instead of only checking expiry on the guest's next request.",
      "Add integration tests for the booking state machine and the inventory locks.",
      "Replace the always-on holiday multiplier with a real holiday calendar.",
    ],
  },
  lab: {
    slug: "webhooks",
    title: "Booking, webhook and pricing lab",
    blurb: "Race two guests for the last room, replay and reorder Stripe webhooks against the real booking states, and price a stay with the real decorator chain.",
    kind: "simulation",
  },
  facts: [
    { claim: "Bookings move through RESERVED, GUEST_ADDED, PAYMENT_PENDING, CONFIRMED and CANCELLED.", evidence: "src/main/java/com/divyansh/airbnbapp/entity/enums/BookingStatus.java:3-9" },
    { claim: "Available inventory for the stay's dates is selected with a PESSIMISTIC_WRITE lock (SELECT … FOR UPDATE).", evidence: "src/main/java/com/divyansh/airbnbapp/repository/InventoryRepository.java:43-56" },
    { claim: "A booking's hold expires 10 minutes after it is created.", evidence: "src/main/java/com/divyansh/airbnbapp/service/BookingServiceImpl.java:315-316" },
    { claim: "The webhook endpoint verifies the Stripe-Signature header with Webhook.constructEvent.", evidence: "src/main/java/com/divyansh/airbnbapp/controller/WebHookController.java:19-31" },
    { claim: "Only checkout.session.completed is handled; it marks the booking CONFIRMED and moves reserved rooms to booked.", evidence: "src/main/java/com/divyansh/airbnbapp/service/BookingServiceImpl.java:161-195" },
    { claim: "Occupancy pricing multiplies the price by 1.2 when more than 80% of rooms are booked.", evidence: "src/main/java/com/divyansh/airbnbapp/strategy/OccupancyPricingStrategy.java:18-21" },
    { claim: "Urgency pricing multiplies the price by 1.25 for dates within the next 7 days.", evidence: "src/main/java/com/divyansh/airbnbapp/strategy/UrgencyPricingStrategy.java:21-23" },
    { claim: "Surge pricing multiplies by an admin-set surgeFactor stored on each inventory row.", evidence: "src/main/java/com/divyansh/airbnbapp/strategy/SurgePricingStrategy.java:16" },
    { claim: "Holiday pricing multiplies by 1.4; the holiday check is currently always true.", evidence: "src/main/java/com/divyansh/airbnbapp/strategy/HolidayPricingStrategy.java:17-21" },
    { claim: "An hourly job reprices inventory for the next year, 100 hotels per page, and updates the HotelMinPrice table.", evidence: "src/main/java/com/divyansh/airbnbapp/service/PricingUpdateService.java:39-56" },
    { claim: "Access tokens last 10 minutes and refresh tokens 7 days.", evidence: "src/main/java/com/divyansh/airbnbapp/security/JWTService.java:29-38" },
  ],
  tags: ["payments", "stripe", "webhooks", "idempotency", "booking", "inventory", "locking", "concurrency", "dynamic pricing", "decorator pattern", "spring boot", "java"],
};

const semages: Project = {
  slug: "semages",
  name: "Semages",
  tagline: "Semantic image search prototype",
  summary:
    "A compact semantic image search prototype. OpenCLIP ViT-B-32 embeds images and text queries into the same 512-dimensional space, Qdrant stores the image vectors and ranks them by cosine similarity, and a Streamlit page handles uploads and search.",
  headline: "Type a sentence, get the photos that match it. No tags, no filenames.",
  period: { label: "Jun 2026", start: "2026-06" },
  status: "complete",
  stack: ["Python", "PyTorch", "OpenCLIP", "Qdrant", "Streamlit", "Pillow"],
  links: { repo: "https://github.com/Divyansh9192/project-semages" },
  repoBranch: "main",
  image: { src: "/images/semages.png", alt: "Illustration of the Semages search flow: a text query matched to images by embedding", width: 1536, height: 1024 },
  metrics: [
    { value: "512", label: "dimensions per embedding, cosine distance", source: "VectorParams in src/indexer.py" },
    { value: "1", label: "shared space for text and images (ViT-B-32, LAION-2B weights)", source: "src/load_model.py" },
    { value: "~180", label: "lines of Python for the whole pipeline", source: "line count of the five source files" },
  ],
  system: {
    nodes: [
      { id: "ui", label: "Streamlit UI", kind: "ui", tech: "Streamlit", note: "Upload, gallery, search box" },
      { id: "images", label: "Image folder", kind: "db", tech: "Local files + Pillow", note: ".png, .jpg, .jpeg" },
      { id: "model", label: "OpenCLIP ViT-B-32", kind: "model", tech: "PyTorch, laion2b_s34b_b79k", note: "Encodes images and text, L2-normalised" },
      { id: "qdrant", label: "Qdrant", kind: "index", tech: "Collection image_search", note: "512-d vectors, cosine distance" },
    ],
    edges: [
      { from: "ui", to: "images", protocol: "other", label: "save uploads" },
      { from: "images", to: "model", protocol: "other", label: "encode_image" },
      { from: "ui", to: "model", protocol: "other", label: "encode_text(query)" },
      { from: "model", to: "qdrant", protocol: "vector", label: "upsert point {path}" },
      { from: "ui", to: "qdrant", protocol: "vector", label: "query_points (top-k)" },
    ],
  },
  caseStudy: {
    intro:
      "Semages answers one question: can you find a photo by describing it, when the photos have no tags, captions or useful filenames? It is a small prototype I built to understand embedding search end to end.",
    problem: [
      "Most photo collections have no metadata worth searching. Keyword search fails on them, and labelling by hand does not scale.",
      "CLIP-style models map images and text into the same vector space, which solves the representation problem. The engineering is everything around the model: indexing, storage, similarity search and an interface people can use.",
    ],
    constraints: [
      "Text and pixels need a representation that can be compared directly.",
      "Results must come back ranked, with a score a person can interpret.",
      "No labelling step: it has to work straight from a folder of images.",
    ],
    architecture:
      "OpenCLIP's ViT-B-32 model with LAION-2B weights (laion2b_s34b_b79k) encodes each image. The vector is L2-normalised and upserted into a Qdrant collection called image_search (512 dimensions, cosine distance) with the file path as payload. A query is tokenised, encoded by the same model, normalised, and sent to Qdrant's query_points, which returns the nearest images with their cosine scores. Streamlit provides upload, a gallery and the search box. An earlier version ran the same search as a brute-force matrix product in memory; Qdrant replaced it so the index lives outside the app process.",
    decisions: [
      { kind: "choice", text: "Use a pretrained CLIP model instead of training one. The goal was the retrieval system, not the model." },
      { kind: "choice", text: "Normalise every vector, for images and queries alike, so cosine similarity is a plain dot product and scores are comparable across queries." },
      { kind: "choice", text: "Move from an in-memory similarity matrix to Qdrant, so the index persists and search no longer needs every vector loaded in the app." },
      { kind: "tradeoff", text: "Points get random ids, so indexing the same folder twice creates duplicates. Content-hash ids would make indexing idempotent." },
      { kind: "tradeoff", text: "A general-purpose model knows nothing about a specific domain. For a narrow collection, a fine-tuned or domain model would rank better." },
    ],
    result:
      "A working end-to-end prototype in about 180 lines of Python: upload images, they are embedded and indexed, then search them in plain English. The lab on this site goes further and runs the same kind of model entirely in your browser.",
    nextSteps: [
      "Use content-hash ids so indexing is idempotent.",
      "Batch embeddings and upserts, and index in the background instead of when the app starts.",
      "Add a small evaluation set to measure retrieval quality, and expose top-k and a score threshold in the UI.",
      "Pin dependencies and add tests.",
    ],
  },
  lab: {
    slug: "semantic-search",
    title: "Semantic search in your browser",
    blurb: "Load a CLIP model in your browser, drop in your own photos, and search them in plain English. Nothing leaves your device.",
    kind: "in-browser",
  },
  facts: [
    { claim: "Images and queries are encoded with OpenCLIP ViT-B-32 using the laion2b_s34b_b79k weights.", evidence: "src/load_model.py:7-11" },
    { claim: "Vectors are stored in a Qdrant collection named image_search with 512 dimensions and cosine distance.", evidence: "src/indexer.py:15-24" },
    { claim: "Both image and text embeddings are L2-normalised before they are stored or searched.", evidence: "src/search.py:25-28" },
    { claim: "Search calls Qdrant query_points and returns the top matches with their cosine scores.", evidence: "src/search.py:20-40" },
    { claim: "Each indexed point carries the image path as its payload.", evidence: "src/indexer.py:39-48" },
  ],
  tags: ["vector search", "embeddings", "clip", "openclip", "qdrant", "retrieval", "semantic search", "ml infrastructure", "computer vision", "python"],
};

export const projects: Project[] = [orchrez, linkedin, neonstays, semages];

export const projectSlugs = projects.map((p) => p.slug);

export function getProject(slug: string): Project | undefined {
  return projects.find((p) => p.slug === slug);
}

/** Labs in display order, each pointing back to its project. */
export const labs: (LabRef & { project: ProjectSlug; projectName: string })[] = projects.map((p) => ({
  ...p.lab,
  project: p.slug,
  projectName: p.name,
}));
