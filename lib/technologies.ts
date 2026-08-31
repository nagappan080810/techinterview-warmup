import type { Difficulty, JobTitle } from "./types";

export interface Technology {
  id: string;
  name: string;
  icon: string;
  shortDescription: string;
  areas: Array<{ name: string; description: string }>;
}

export const TECHNOLOGIES: Technology[] = [
  {
    id: "java",
    name: "Java",
    icon: "☕",
    shortDescription: "Core Java, OOP, collections, concurrency, JVM, Java 21 features.",
    areas: [
      { name: "Core Java & OOP", description: "Classes, interfaces, inheritance, polymorphism, encapsulation, abstraction, composition vs inheritance." },
      { name: "Collections & Generics", description: "List/Set/Map, iteration, equality/hashCode, Collections API, generic bounds and wildcards." },
      { name: "Concurrency", description: "Threads, synchronized, volatile, Executors, CompletableFuture, thread safety, ConcurrentHashMap." },
      { name: "JVM Internals & Java 21", description: "Memory model, GC, records, sealed types, pattern matching, virtual threads, streams." },
    ],
  },
  {
    id: "core-dsa",
    name: "Core DSA",
    icon: "🧮",
    shortDescription: "Data structures, algorithms, complexity analysis for coding interviews.",
    areas: [
      { name: "Arrays & Strings", description: "Two pointers, sliding window, hashing, in-place manipulation, string algorithms." },
      { name: "Linked Lists & Trees", description: "Traversal, reversal, cycle detection, BST, DFS/BFS, balanced trees." },
      { name: "Graphs & Search", description: "DFS, BFS, topological sort, shortest paths, union-find, MST." },
      { name: "Dynamic Programming & Complexity", description: "Memoization, tabulation, classic DP patterns, big-O analysis." },
    ],
  },
  {
    id: "system-design",
    name: "System Design",
    icon: "🏗️",
    shortDescription: "Architecture, scalability, distributed systems, trade-offs.",
    areas: [
      { name: "Scalability & Caching", description: "Load balancing, horizontal scaling, caching layers, CDN, stateless vs stateful." },
      { name: "Data & Storage", description: "SQL vs NoSQL, sharding, replication, consistency models, CAP theorem." },
      { name: "Distributed Systems", description: "Message queues, event streaming, idempotency, distributed transactions, consensus." },
      { name: "Architecture Patterns", description: "Monolith vs microservices, event-driven, CQRS/Event Sourcing, API design, back-of-envelope estimates." },
    ],
  },
  {
    id: "react",
    name: "React",
    icon: "⚛️",
    shortDescription: "Components, hooks, state, rendering, performance, React 19.",
    areas: [
      { name: "Hooks", description: "useState, useEffect, context, useMemo/useCallback, plus React 19 hooks (useActionState, useOptimistic, useFormStatus)." },
      { name: "Rendering & Performance", description: "Re-renders, memoization, reconciliation, Suspense, lazy loading, concurrent features." },
    ],
  },
  {
    id: "react-nextjs",
    name: "React with Next.js",
    icon: "▲",
    shortDescription: "Next.js App Router, Server Components, Server Actions, SSR.",
    areas: [
      { name: "App Router & Data", description: "File-based routing, layouts, loading/error boundaries, caching, data fetching patterns." },
      { name: "Server Components & Actions", description: "RSC model, Server Actions, streaming SSR, Suspense, when to use 'use client'." },
    ],
  },
  {
    id: "angular",
    name: "Angular",
    icon: "🅰️",
    shortDescription: "Signals, standalone, RxJS, change detection, performance.",
    areas: [
      { name: "Signals & State", description: "Signal, computed, effect, input/output, SignalStore, signal-based state management." },
      { name: "Core Concepts", description: "Standalone components, DI, RxJS interop, forms, routing." },
      { name: "Change Detection & Performance", description: "Zone.js vs zoneless, OnPush, @defer, trackBy, lazy loading." },
    ],
  },
  {
    id: "node-backend",
    name: "Node / Backend",
    icon: "🟩",
    shortDescription: "Node.js, Express/Nest, APIs, databases, producer-side best practices.",
    areas: [
      { name: "Node Runtime", description: "Event loop, streams, workers, buffer handling, async patterns, error handling." },
      { name: "APIs & Services", description: "REST/RPC, validation, auth middleware, rate limiting, caching, observability." },
      { name: "Databases & Queues", description: "Connection pooling, transactions, ORMs, Redis, message queues, idempotency." },
    ],
  },
  {
    id: "spring-boot",
    name: "Spring Boot",
    icon: "🍃",
    shortDescription: "Boot 3.x, DI, auto-configuration, Spring AI, resilience, gateway.",
    areas: [
      { name: "Core & Auto-configuration", description: "DI, beans, configuration properties, Actuator, starters." },
      { name: "Data & Messaging", description: "Spring Data JPA, transactions, Kafka integration, outbox pattern." },
      { name: "Cloud & Resilience", description: "Spring Cloud Gateway, Resilience4j, distributed tracing/logging, security with OAuth2." },
    ],
  },
  {
    id: "auth",
    name: "Auth Concepts",
    icon: "🔐",
    shortDescription: "Authentication, authorization, OAuth2, JWT, WebAuthn, RBAC.",
    areas: [
      { name: "Authentication", description: "Sessions vs tokens, JWT vs opaque, OAuth2 flows + PKCE, OIDC, MFA/WebAuthn, SSO." },
      { name: "Authorization", description: "RBAC, ABAC, ACL, claims/scopes, policy engines (OPA/Cedar)." },
    ],
  },
  {
    id: "design-patterns",
    name: "Design Patterns",
    icon: "🧩",
    shortDescription: "GOF creational, structural, behavioral patterns and when to use them.",
    areas: [
      { name: "Creational", description: "Singleton, Factory, Abstract Factory, Builder, Prototype." },
      { name: "Structural", description: "Adapter, Decorator, Facade, Proxy, Composite." },
      { name: "Behavioral", description: "Strategy, Observer, Command, State, Template Method, Chain of Responsibility." },
    ],
  },
  {
    id: "twelve-factor",
    name: "Twelve-Factor App",
    icon: "📜",
    shortDescription: "The twelve factors for building scalable, cloud-native apps.",
    areas: [
      { name: "Core Factors", description: "Codebase, dependencies, config in env, backing services, build/release/run." },
      { name: "Operations Factors", description: "Port binding, concurrency, disposability, dev/prod parity, logs as event streams, admin processes." },
    ],
  },
  {
    id: "kubernetes",
    name: "Kubernetes for Microservices",
    icon: "⛵",
    shortDescription: "Workloads, networking, scaling, operators, service mesh.",
    areas: [
      { name: "Workloads & Config", description: "Pods, Deployments, StatefulSets, ConfigMaps/Secrets, probes, PDBs, resource requests/limits." },
      { name: "Networking & Services", description: "Services, Ingress/Gateway API, NetworkPolicies, service mesh, DNS." },
      { name: "Scaling & Operations", description: "HPA/VPA, RBAC, operators, update strategies, chaos/self-healing." },
    ],
  },
];

export function getTechnology(id: string): Technology | undefined {
  return TECHNOLOGIES.find((t) => t.id === id);
}

export const DIFFICULTIES: Difficulty[] = ["Easy", "Medium", "Hard", "Mixed"];

export const JOB_TITLES: JobTitle[] = [
  "Junior Developer",
  "Mid-level Developer",
  "Senior Developer",
  "Lead",
  "Architect",
];