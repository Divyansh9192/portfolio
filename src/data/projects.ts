export type DiagramNode = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  sublabel?: string;
  variant: "teal" | "amber" | "neutral";
};

export type DiagramEdge = {
  from: string;
  to: string;
};

export type Diagram = {
  viewBox: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
};

export type Decision = {
  type: "choice" | "tradeoff";
  text: string;
};

export type Stat = {
  value: string;
  label: string;
};

export type Project = {
  slug: string;
  name: string;
  tagline: string;
  flag?: string;
  description: string;
  stack: string[];
  links: { repo?: string; live?: string };
  status: string;
  cardDiagram: Diagram;
  caseStudy: {
    index: number;
    intro: string;
    problem: { heading: string; body: string[] };
    constraints: { heading: string; items: string[] };
    architecture: { heading: string; body: string; diagram: Diagram; caption: string; annotation?: string };
    decisions: { heading: string; items: Decision[] };
    result: { heading: string; body: string; stats: Stat[] };
  };
};

export const projects: Project[] = [
  {
    slug: "orchrez",
    name: "Orchrez",
    tagline: "Multi-tenant AI marketing automation platform",
    // flag: "hardest one",
    description:
      "Each tenant's brand identity — palette, tone, composition style, visual motifs — is encoded as structured \"brand DNA\" so AI-generated marketing assets stay on-brand without manual review. Async generation runs through Celery/RabbitMQ with LangGraph orchestrating multi-step agent pipelines, and Razorpay webhooks handle billing with idempotency to survive retries.",
    stack: ["FastAPI", "LangGraph", "Celery / RabbitMQ", "PostgreSQL + pgvector", "Redis", "Next.js", "Razorpay"],
    links: { repo: "#" },
    status: "In development",
    cardDiagram: {
      viewBox: "0 0 240 160",
      nodes: [
        { id: "tenant", x: 8, y: 14, w: 64, h: 30, label: "Tenant", variant: "teal" },
        { id: "branddna", x: 8, y: 64, w: 64, h: 36, label: "Brand DNA", sublabel: "pgvector", variant: "teal" },
        { id: "celery", x: 92, y: 64, w: 60, h: 32, label: "Celery Q", variant: "neutral" },
        { id: "aigen", x: 172, y: 18, w: 60, h: 36, label: "AI Gen", sublabel: "Engine", variant: "amber" },
        { id: "langgraph", x: 172, y: 108, w: 60, h: 36, label: "LangGraph", variant: "neutral" },
      ],
      edges: [
        { from: "tenant", to: "celery" },
        { from: "branddna", to: "celery" },
        { from: "celery", to: "aigen" },
        { from: "celery", to: "langgraph" },
      ],
    },
    caseStudy: {
      index: 1,
      intro:
        "A multi-tenant AI platform that generates on-brand marketing assets automatically — the hard part wasn't generating images, it was making the AI generate the right images for a specific brand, every time.",
      problem: {
        heading: "Generic AI marketing tools produce generic marketing assets",
        body: [
          "Most AI image generators take a prompt and return something plausible-looking, but disconnected from any specific brand. For a marketing automation platform serving multiple tenants, that's a dealbreaker — a fintech startup and a kids' toy brand can't get the same visual treatment just because they typed similar prompts.",
          "Orchrez needed to take a brand's actual identity — color palette, tone of voice, preferred composition style, recurring visual motifs — and make every generated asset look like it came from that brand's own design team, automatically, without a human reviewing each output.",
        ],
      },
      constraints: {
        heading: "What made this hard",
        items: [
          "Multi-tenancy at the data layer. Every tenant's brand profile, generated assets, and billing state needed strict isolation, without spinning up separate infrastructure per tenant.",
          "Generation is slow and expensive. AI image generation can't block an HTTP request — it needs to run async, be retryable, and report progress.",
          "Payments can't double-charge. Razorpay webhooks can fire more than once for the same event; billing logic has to be idempotent or tenants get charged twice.",
          "\"On-brand\" had to be encoded, not eyeballed. There's no API that takes \"make it look like our brand\" — that concept had to be broken into structured, storable data.",
        ],
      },
      architecture: {
        heading: "How the pieces fit together",
        body:
          "Each tenant's brand identity is encoded as a structured \"brand DNA\" record — palette, tone descriptors, composition preferences, and motif embeddings stored in PostgreSQL with pgvector. When a generation request comes in, it's queued through Celery/RabbitMQ rather than handled inline, and a LangGraph pipeline pulls the relevant brand DNA into the generation prompt at each step, checking the output against the brand's visual fingerprint before it's marked complete.",
        diagram: {
          viewBox: "0 0 760 280",
          nodes: [
            { id: "tenant", x: 20, y: 20, w: 140, h: 60, label: "Tenant", sublabel: "request", variant: "teal" },
            { id: "branddna", x: 20, y: 120, w: 140, h: 60, label: "Brand DNA store", sublabel: "Postgres + pgvector", variant: "teal" },
            { id: "fastapi", x: 220, y: 70, w: 140, h: 60, label: "FastAPI", sublabel: "accepts & queues", variant: "neutral" },
            { id: "celery", x: 420, y: 70, w: 140, h: 60, label: "Celery / RabbitMQ", sublabel: "async job queue", variant: "neutral" },
            { id: "langgraph", x: 620, y: 20, w: 120, h: 60, label: "LangGraph", sublabel: "gen pipeline", variant: "amber" },
            { id: "brandcheck", x: 620, y: 120, w: 120, h: 60, label: "Brand check", sublabel: "embedding match", variant: "amber" },
            { id: "webhook", x: 220, y: 200, w: 320, h: 55, label: "Razorpay webhook handler", sublabel: "idempotency key per event", variant: "neutral" },
          ],
          edges: [
            { from: "tenant", to: "fastapi" },
            { from: "branddna", to: "fastapi" },
            { from: "fastapi", to: "celery" },
            { from: "celery", to: "langgraph" },
            { from: "langgraph", to: "brandcheck" },
            { from: "celery", to: "webhook" },
          ],
        },
        caption: "Simplified system diagram — request → brand DNA lookup → async generation → brand-fidelity check → billing.",
        annotation: "the hard part",
      },
      decisions: {
        heading: "Choices I'd defend in an interview",
        items: [
          { type: "choice", text: "Store brand DNA as vector embeddings rather than just structured fields (hex codes, tone tags). This lets the system measure \"how on-brand is this output\" as a similarity score, not a rules checklist." },
          { type: "tradeoff", text: "Vector similarity is fuzzier than hard rules — it can't guarantee a generated asset never violates a brand constraint, only that it's statistically close. For early-stage automation that's an acceptable tradeoff against full manual review." },
          { type: "choice", text: "Queue every generation job through Celery/RabbitMQ instead of handling it inline in the request-response cycle, so slow generation never ties up an API worker." },
          { type: "tradeoff", text: "Async generation means the frontend needs polling or websockets to show progress, adding complexity the synchronous version wouldn't have needed." },
          { type: "choice", text: "Built idempotency keys into the Razorpay webhook handler from day one rather than retrofitting them after a duplicate-charge incident." },
        ],
      },
      result: {
        heading: "Where it stands",
        body:
          "Orchrez is still in active development — the architecture above is built and working for the core generation and billing flows. It's the project I'd point to first for any role touching agent orchestration, multi-tenant systems, or async pipeline design.",
        stats: [
          { value: "Multi-tenant", label: "isolated by design, shared infra" },
          { value: "Async-first", label: "no blocking generation calls" },
          { value: "Idempotent", label: "billing survives webhook retries" },
        ],
      },
    },
  },
  {
    slug: "linkedin-clone",
    name: "LinkedIn Clone",
    tagline: "6-microservice distributed system",
    description:
      "Auth, profile, feed, connections, messaging, and notifications split into independently deployable Spring Boot services, communicating over Kafka for event-driven consistency. Neo4j models the connection graph for recommendation queries that would be painful in a relational schema. Containerized with Docker, orchestrated on Kubernetes, secured with JWT.",
    stack: ["Spring Boot", "Apache Kafka", "Neo4j", "PostgreSQL", "Docker", "Kubernetes", "JWT"],
    links: { repo: "#" },
    status: "Complete",
    cardDiagram: {
      viewBox: "0 0 240 170",
      nodes: [
        { id: "gateway", x: 88, y: 8, w: 64, h: 28, label: "Gateway", variant: "amber" },
        { id: "auth", x: 8, y: 68, w: 50, h: 30, label: "Auth", sublabel: "JWT", variant: "teal" },
        { id: "profile", x: 66, y: 68, w: 50, h: 30, label: "Profile", variant: "teal" },
        { id: "feed", x: 124, y: 68, w: 50, h: 30, label: "Feed", variant: "teal" },
        { id: "chat", x: 182, y: 68, w: 50, h: 30, label: "Chat", variant: "teal" },
        { id: "kafka", x: 40, y: 128, w: 160, h: 32, label: "Kafka bus", sublabel: "+ Neo4j", variant: "neutral" },
      ],
      edges: [
        { from: "gateway", to: "auth" },
        { from: "gateway", to: "profile" },
        { from: "gateway", to: "feed" },
        { from: "gateway", to: "chat" },
        { from: "auth", to: "kafka" },
        { from: "profile", to: "kafka" },
        { from: "feed", to: "kafka" },
        { from: "chat", to: "kafka" },
      ],
    },
    caseStudy: {
      index: 2,
      intro:
        "A 6-service distributed system built to learn what actually breaks when you split a monolith into microservices — not in theory, but in the schema design, the network calls, and the failure modes.",
      problem: {
        heading: "Social networks aren't really CRUD apps",
        body: [
          "A professional network looks simple from the outside — profiles, posts, connections, messages — but the underlying problems are graph traversal (who's in my network, who's a mutual connection), event fan-out (a post needs to reach a feed without every service polling every other service), and consistency across services that don't share a database.",
          "I wanted to build this as separate, independently deployable services on purpose, to force myself to deal with the distributed-systems problems a single Spring Boot monolith would let me avoid.",
        ],
      },
      constraints: {
        heading: "What made this hard",
        items: [
          "No shared database across services. Each service owns its own data, which means cross-service queries (e.g. \"show me posts from my connections\") require coordination, not a SQL join.",
          "Connection graphs don't fit relational tables well. \"Mutual connections\" and \"2nd-degree network\" queries get expensive fast in Postgres; they're naturally a graph problem.",
          "Services need to agree on identity. Auth has to issue a token that every other service can verify independently, without calling back to the auth service on every request.",
          "Local dev for 6 services is its own problem. Docker Compose for local orchestration, Kubernetes manifests for anything resembling production behavior.",
        ],
      },
      architecture: {
        heading: "How the pieces fit together",
        body:
          "An API gateway routes requests to the relevant service. Auth issues JWTs that Profile, Feed, and Chat verify independently — no auth-service round-trip per request. Profile, Feed, and Connections publish events to Kafka rather than calling each other directly, so a new post reaching followers' feeds is an async event-consumption problem, not a synchronous fan-out of HTTP calls. Connection and network-graph queries run against Neo4j instead of Postgres.",
        diagram: {
          viewBox: "0 0 760 280",
          nodes: [
            { id: "gateway", x: 300, y: 15, w: 160, h: 50, label: "API Gateway", sublabel: "routes + JWT verify", variant: "amber" },
            { id: "auth", x: 20, y: 110, w: 130, h: 55, label: "Auth service", sublabel: "issues JWT", variant: "teal" },
            { id: "profile", x: 170, y: 110, w: 130, h: 55, label: "Profile", sublabel: "Postgres", variant: "teal" },
            { id: "feed", x: 320, y: 110, w: 130, h: 55, label: "Feed", sublabel: "Postgres", variant: "teal" },
            { id: "connections", x: 470, y: 110, w: 130, h: 55, label: "Connections", sublabel: "Neo4j graph", variant: "teal" },
            { id: "chat", x: 620, y: 110, w: 120, h: 55, label: "Chat", sublabel: "Postgres", variant: "teal" },
            { id: "kafka", x: 170, y: 210, w: 430, h: 50, label: "Apache Kafka — event bus", sublabel: "post.created · connection.made · message.sent", variant: "neutral" },
          ],
          edges: [
            { from: "gateway", to: "auth" },
            { from: "gateway", to: "profile" },
            { from: "gateway", to: "feed" },
            { from: "gateway", to: "connections" },
            { from: "gateway", to: "chat" },
            { from: "profile", to: "kafka" },
            { from: "feed", to: "kafka" },
            { from: "connections", to: "kafka" },
            { from: "chat", to: "kafka" },
          ],
        },
        caption: "Simplified system diagram — gateway routes to services, services communicate via Kafka, not directly.",
      },
      decisions: {
        heading: "Choices I'd defend in an interview",
        items: [
          { type: "choice", text: "Stateless JWT verification at each service instead of a session lookup against the auth service on every request — keeps services independent and avoids auth becoming a bottleneck." },
          { type: "tradeoff", text: "Revoking a token before its expiry (e.g. on logout or ban) is harder without a central session store — this version accepts short token lifetimes as the mitigation rather than building a revocation list." },
          { type: "choice", text: "Used Neo4j specifically for the connections service rather than forcing graph queries into Postgres with recursive CTEs, which get slow past 2nd-degree connections." },
          { type: "tradeoff", text: "Running Postgres for four services and Neo4j for one means two different backup, monitoring, and ops patterns instead of one — a real cost at this team size, justified here mainly as a learning exercise." },
        ],
      },
      result: {
        heading: "Where it stands",
        body:
          "All 6 services run independently via Docker Compose locally, with Kubernetes manifests for deployment. This is the project I lead with for any Java/Spring Boot backend role — it's the clearest evidence I can reason about service boundaries, not just write CRUD endpoints inside one app.",
        stats: [
          { value: "6", label: "independently deployable services" },
          { value: "Event-driven", label: "Kafka instead of direct calls" },
          { value: "Graph-native", label: "Neo4j for the connection model" },
        ],
      },
    },
  },
  {
    slug: "neonstays",
    name: "NeonStays",
    tagline: "Hotel booking platform — deployed live",
    description:
      "Dual-backend architecture: Spring Boot handles bookings, auth, and the 25+ REST endpoint core, while a separate FastAPI service handles search. Stripe webhooks process payment confirmation asynchronously, decoupled from the booking flow so a slow payment provider can't block checkout.",
    stack: ["Spring Boot", "FastAPI", "React", "PostgreSQL", "Stripe"],
    links: { live: "#" },
    status: "Live",
    cardDiagram: {
      viewBox: "0 0 230 160",
      nodes: [
        { id: "react", x: 8, y: 64, w: 58, h: 32, label: "React UI", variant: "teal" },
        { id: "spring", x: 90, y: 16, w: 68, h: 32, label: "Spring Boot", variant: "teal" },
        { id: "fastapi", x: 90, y: 112, w: 68, h: 32, label: "FastAPI", sublabel: "search", variant: "teal" },
        { id: "postgres", x: 178, y: 16, w: 48, h: 32, label: "Postgres", variant: "neutral" },
        { id: "stripe", x: 178, y: 112, w: 48, h: 32, label: "Stripe", sublabel: "webhook", variant: "amber" },
      ],
      edges: [
        { from: "react", to: "spring" },
        { from: "react", to: "fastapi" },
        { from: "spring", to: "postgres" },
        { from: "fastapi", to: "stripe" },
      ],
    },
    caseStudy: {
      index: 3,
      intro:
        "A hotel booking platform with a deliberately split backend — one service for transactional booking logic, a separate one for search — deployed and reachable live.",
      problem: {
        heading: "Booking and search have different scaling shapes",
        body: [
          "Booking is write-heavy, transactional, and absolutely cannot lose a booking or double-charge a customer. Search is read-heavy, latency-sensitive, and benefits from being scaled and optimized completely independently of the booking path. Bundling both into one service means every scaling decision is a compromise between two different workloads.",
        ],
      },
      constraints: {
        heading: "What made this hard",
        items: [
          "Payment confirmation is asynchronous by nature. Stripe confirms a payment via webhook, not as a direct response to the booking request — the booking flow has to handle \"payment pending\" as a real state, not an edge case.",
          "25+ REST endpoints need consistent conventions. Pagination, error shapes, and auth had to be consistent across that many endpoints or the API becomes painful to consume.",
          "Two backend languages, one product. Spring Boot and FastAPI needed to agree on data contracts even though they're different ecosystems with different serialization defaults.",
          "It had to actually deploy. A project that only runs on localhost doesn't prove anything about real-world deployment constraints — env config, CORS, and production database connections all had to work.",
        ],
      },
      architecture: {
        heading: "How the pieces fit together",
        body:
          "React talks to two backends: Spring Boot owns bookings, users, and the core REST API surface; FastAPI owns search, kept separate so search performance work never risks the booking path. Stripe webhooks land on a dedicated endpoint that updates booking status asynchronously — checkout doesn't block waiting for payment confirmation, it polls or gets notified once the webhook lands.",
        diagram: {
          viewBox: "0 0 760 240",
          nodes: [
            { id: "react", x: 20, y: 90, w: 140, h: 60, label: "React UI", sublabel: "booking + search", variant: "teal" },
            { id: "spring", x: 240, y: 20, w: 160, h: 60, label: "Spring Boot", sublabel: "bookings · 25+ endpoints", variant: "teal" },
            { id: "fastapi", x: 240, y: 160, w: 160, h: 60, label: "FastAPI", sublabel: "search service", variant: "teal" },
            { id: "postgres", x: 460, y: 20, w: 130, h: 60, label: "PostgreSQL", sublabel: "bookings, users", variant: "neutral" },
            { id: "stripe", x: 460, y: 160, w: 130, h: 60, label: "Stripe", sublabel: "async webhook", variant: "amber" },
          ],
          edges: [
            { from: "react", to: "spring" },
            { from: "react", to: "fastapi" },
            { from: "spring", to: "postgres" },
            { from: "fastapi", to: "stripe" },
          ],
        },
        caption: "Simplified system diagram — dual backend, async payment confirmation decoupled from checkout.",
      },
      decisions: {
        heading: "Choices I'd defend in an interview",
        items: [
          { type: "choice", text: "Split search into its own FastAPI service rather than adding search endpoints to the Spring Boot app, so search-specific tuning never risks booking reliability." },
          { type: "tradeoff", text: "Two backends means two deployment pipelines, two sets of logs, and a data contract that has to stay in sync across Java and Python serialization conventions." },
          { type: "choice", text: "Treated Stripe webhook confirmation as the source of truth for payment status, rather than trusting the client-side success callback, which can fire even if the webhook hasn't landed yet." },
        ],
      },
      result: {
        heading: "Where it stands",
        body:
          "NeonStays is deployed and reachable — it's the project that proves I can ship, not just architect on paper. It's my lead project for full-stack roles where the interviewer wants to see something working in a browser, not just a repo.",
        stats: [
          { value: "25+", label: "REST API endpoints" },
          { value: "Dual backend", label: "Spring Boot + FastAPI" },
          { value: "Deployed", label: "live, not just local" },
        ],
      },
    },
  },
  {
    slug: "semages",
    name: "Semages",
    tagline: "Semantic image search",
    description:
      "Natural-language image retrieval without keyword tags. OpenCLIP encodes both query text and the image corpus into the same embedding space, and Qdrant runs the cosine-similarity search at retrieval time — so \"a dog running on a beach at sunset\" finds the right image even with zero matching metadata.",
    stack: ["PyTorch", "OpenCLIP", "Qdrant", "Streamlit", "Pillow"],
    links: { repo: "#" },
    status: "Complete",
    cardDiagram: {
      viewBox: "0 0 230 160",
      nodes: [
        { id: "query", x: 8, y: 64, w: 62, h: 32, label: "Text query", sublabel: "Streamlit", variant: "teal" },
        { id: "clip", x: 84, y: 64, w: 62, h: 32, label: "OpenCLIP", sublabel: "ViT-B-32", variant: "neutral" },
        { id: "qdrant", x: 160, y: 64, w: 62, h: 32, label: "Qdrant", sublabel: "cosine sim", variant: "amber" },
      ],
      edges: [
        { from: "query", to: "clip" },
        { from: "clip", to: "qdrant" },
      ],
    },
    caseStudy: {
      index: 4,
      intro:
        "Search an image collection using plain-English descriptions, with zero tags, zero keywords, and zero manual labeling — by matching meaning, not metadata.",
      problem: {
        heading: "Keyword search fails the moment images aren't labeled",
        body: [
          "Traditional image search relies on filenames, alt text, or manual tags — none of which exist for most real image collections. I wanted to search by describing what's in the image in natural language (\"a dog running on a beach at sunset\") and get relevant results even when no metadata matches those words at all.",
        ],
      },
      constraints: {
        heading: "What made this hard",
        items: [
          "Text and images live in different representations. A search query is text; the corpus is pixels. Something has to translate both into a comparable form.",
          "Similarity search has to be fast at scale. Brute-force comparing a query against every image embedding doesn't scale past a small demo collection.",
          "No labeling pipeline. The whole point was avoiding manual tagging, so the system had to work directly from raw images.",
        ],
      },
      architecture: {
        heading: "How the pieces fit together",
        body:
          "OpenCLIP's ViT-B-32 model encodes both the search query text and every image in the corpus into the same shared embedding space — so a sentence and a photo that mean the same thing end up as nearby vectors. Qdrant stores those image embeddings and runs the cosine-similarity search at query time, returning ranked results far faster than a linear scan would allow. Streamlit provides the interface for typing a query and viewing ranked results.",
        diagram: {
          viewBox: "0 0 760 200",
          nodes: [
            { id: "streamlit", x: 20, y: 70, w: 140, h: 60, label: "Streamlit", sublabel: "text query in", variant: "teal" },
            { id: "clip", x: 220, y: 70, w: 160, h: 60, label: "OpenCLIP ViT-B-32", sublabel: "text + image → embedding", variant: "neutral" },
            { id: "qdrant", x: 440, y: 70, w: 140, h: 60, label: "Qdrant", sublabel: "cosine similarity", variant: "amber" },
            { id: "results", x: 640, y: 70, w: 100, h: 60, label: "Ranked", sublabel: "results", variant: "teal" },
          ],
          edges: [
            { from: "streamlit", to: "clip" },
            { from: "clip", to: "qdrant" },
            { from: "qdrant", to: "results" },
          ],
        },
        caption: "Simplified system diagram — query and corpus share one embedding space; Qdrant ranks by similarity.",
      },
      decisions: {
        heading: "Choices I'd defend in an interview",
        items: [
          { type: "choice", text: "Used a pretrained OpenCLIP model rather than training an embedding model from scratch — the goal was building the retrieval system, not re-deriving a vision-language model with limited data and compute." },
          { type: "tradeoff", text: "A general-purpose pretrained model won't capture domain-specific nuance as well as a fine-tuned one would for a narrow image domain — acceptable here since the goal was a general semantic search demo, not a specialized product." },
          { type: "choice", text: "Chose Qdrant over a brute-force cosine similarity loop specifically to prove out the part of the system that has to hold up at real corpus sizes." },
        ],
      },
      result: {
        heading: "Where it stands",
        body:
          "Semages works as a complete pipeline from text query to ranked image results. It's the project I point to for anything touching ML infrastructure, vector databases, or retrieval systems — proof that I can wire a pretrained model into a real, queryable search system, not just call an API.",
        stats: [
          { value: "Zero-label", label: "no manual tagging needed" },
          { value: "Vector search", label: "Qdrant cosine similarity" },
          { value: "Natural language", label: "free-text queries" },
        ],
      },
    },
  },
];

export const profile = {
  name: "Divyansh Deep",
  email: "divyanshdeep.dev@gmail.com",
  phone: "+91 7007509438",
  github: "https://github.com/Divyansh9192",
  linkedin: "https://linkedin.com/in/Divyansh9192",
};

export const timeline = [
  {
    date: "2023 — 2027",
    title: "B.Tech, Computer Science & Engineering",
    body: "JSS Academy of Technical Education, Noida. Final-year, focused on backend systems, distributed architecture, and applied AI.",
  },
  {
    date: "Open source",
    title: "Merged PR into Jenkins core",
    body: "Contributed a change that was reviewed and merged into the core Jenkins project — production CI/CD infrastructure used industry-wide.",
  },
  {
    date: "Hackathon",
    title: "1st place — Stellaris Hackathon",
    body: "Won first place with team \"chillBuddies,\" building and shipping a working product under a hard deadline.",
  },
];
