import type { Achievement, EducationItem, Profile, SkillGroup } from "./types";

// Source: public/resume.pdf (latest), cross-checked with the previous site copy.

export const profile: Profile = {
  name: "Divyansh Deep",
  role: "Backend & AI-agent engineer",
  pitch: "I build the systems behind the interface: event-driven services, durable agent workflows and the queues, ledgers and indexes that keep them honest.",
  about: [
    "I'm a final-year Computer Science student at JSS Academy of Technical Education, Noida. Most of what I build lives behind an API: microservices that talk over Kafka, LangGraph workflows that survive restarts, payment flows that don't double-charge, and vector search that finds images by meaning.",
    "I care about the parts that only show up under load or failure: retries, idempotency, isolation between tenants, and what a system does when a dependency is slow. This site is built the same way. It traces your request, exposes its own health, and answers to curl and to AI agents as well as browsers.",
  ],
  location: "Noida, India",
  availability: "Open to backend, full-stack and AI-agent engineering internships. If you're hiring, or just want to talk systems, my inbox is open.",
  email: "divyanshdeep.dev@gmail.com",
  links: {
    github: "https://github.com/Divyansh9192",
    linkedin: "https://linkedin.com/in/Divyansh9192",
  },
  resumePdf: "/resume.pdf",
};

export const education: EducationItem[] = [
  {
    school: "JSS Academy of Technical Education",
    place: "Noida, India",
    degree: "B.Tech, Computer Science & Engineering",
    period: "2023 – present (4th year)",
    detail: "CGPA 8.01 / 10",
  },
  {
    school: "Green Valley English School",
    place: "Varanasi, Uttar Pradesh",
    degree: "Intermediate (Class XII)",
    period: "2022",
    detail: "94.4%",
  },
  {
    school: "Green Valley English School",
    place: "Varanasi, Uttar Pradesh",
    degree: "Matriculation (Class X)",
    period: "2020",
    detail: "95.6%",
  },
];

export const achievements: Achievement[] = [
  {
    title: "1st place, Stellaris Hackathon",
    org: "ABES Engineering College × GeeksforGeeks ABESEC",
    detail: "Won first place as part of team chillBuddies.",
  },
  {
    title: "Open-source contributor, Jenkins",
    org: "Jenkins (jenkinsci)",
    detail: "Merged a pull request into Jenkins core, the open-source CI/CD automation server.",
  },
];

export const skills: SkillGroup[] = [
  { label: "Languages", items: ["Java", "Python", "TypeScript / JavaScript", "C"] },
  { label: "Backend & web", items: ["Spring Boot", "Spring Cloud", "FastAPI", "REST APIs", "Microservices", "React", "Next.js"] },
  { label: "AI & orchestration", items: ["LangGraph", "Multi-agent workflows", "LLM integration (OpenRouter, Gemini, Vertex AI)"] },
  { label: "Data", items: ["PostgreSQL", "pgvector", "MySQL", "Neo4j", "Redis", "Qdrant"] },
  { label: "Messaging", items: ["Apache Kafka", "RabbitMQ", "Celery", "Event-driven architecture"] },
  { label: "Infrastructure", items: ["Docker", "Docker Compose", "Kubernetes", "Eureka", "Spring Cloud Gateway"] },
  { label: "Fundamentals", items: ["Data structures & algorithms", "DBMS", "Operating systems", "Computer networks", "System design"] },
];
