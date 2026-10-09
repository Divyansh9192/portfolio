import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { evidenceUrl, getProject, profile } from "@/content";
import { Container, MonoLabel, SectionHeader, TextLink } from "@/components/ui/primitives";
import { KafkaLab } from "@/components/labs/kafka/KafkaLab";

const title = "Kafka rebalance playground";
const description =
  "A simulation of the LinkedIn clone's Kafka flow with its real topics, keys and consumer group. Publish events, watch murmur2 pick partitions, scale or crash notification-service, and slow down connections-service to see lag build.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/labs/kafka" },
  openGraph: { type: "website", siteName: profile.name, title: `${title} · ${profile.name}`, description, url: "/labs/kafka" },
  twitter: { card: "summary_large_image", title: `${title} · ${profile.name}`, description },
};

interface Cite {
  path: string;
  label?: string;
}

interface RealItem {
  claim: string;
  cites: Cite[];
}

const P = {
  postsTopics: "posts-service/src/main/java/com/divyansh/linkedin/posts_service/config/KafkaTopicConfig.java:11-17",
  connTopics: "connections-service/src/main/java/com/divyansh/linkedin/connections_service/config/KafkaTopicConfig.java:11-17",
  createPost: "posts-service/src/main/java/com/divyansh/linkedin/posts_service/service/PostService.java:40",
  postCreatedEvent: "posts-service/src/main/java/com/divyansh/linkedin/posts_service/event/PostCreatedEvent.java:9-13",
  likePost: "posts-service/src/main/java/com/divyansh/linkedin/posts_service/service/PostLikeService.java:49",
  postLikedEvent: "posts-service/src/main/java/com/divyansh/linkedin/posts_service/event/PostLikedEvent.java:9-11",
  sendRequest: "connections-service/src/main/java/com/divyansh/linkedin/connections_service/service/ConnectionsService.java:57",
  acceptRequest: "connections-service/src/main/java/com/divyansh/linkedin/connections_service/service/ConnectionsService.java:74",
  acceptCheck: "connections-service/src/main/java/com/divyansh/linkedin/connections_service/service/ConnectionsService.java:62-68",
  postsSerializer: "posts-service/src/main/resources/application.yaml:7-8",
  connSerializer: "connections-service/src/main/resources/application.yaml:12-13",
  groupId: "notification-service/src/main/resources/application.yaml:23",
  deserializers: "notification-service/src/main/resources/application.yaml:24-29",
  postsListeners: "notification-service/src/main/java/com/divyansh/linkedin/notification_service/consumer/PostsServiceConsumer.java:23-42",
  connListeners: "notification-service/src/main/java/com/divyansh/linkedin/notification_service/consumer/ConnectionsServiceConsumer.java:18-31",
  feignCall: "notification-service/src/main/java/com/divyansh/linkedin/notification_service/consumer/PostsServiceConsumer.java:26-31",
  feignClient: "notification-service/src/main/java/com/divyansh/linkedin/notification_service/clients/ConnectionsClient.java:10-14",
  sendNotification: "notification-service/src/main/java/com/divyansh/linkedin/notification_service/service/SendNotification.java:15-20",
  firstDegree: "connections-service/src/main/java/com/divyansh/linkedin/connections_service/repository/PersonRepository.java:15-18",
  addConnection: "connections-service/src/main/java/com/divyansh/linkedin/connections_service/repository/PersonRepository.java:41-46",
  bootParent: "notification-service/pom.xml:5-10",
  kafkaStarter: "notification-service/pom.xml:38-41",
};

const REAL_ITEMS: RealItem[] = [
  {
    claim: "Four topics, each declared as new NewTopic(name, 3, (short) 1): 3 partitions, replication factor 1.",
    cites: [{ path: P.postsTopics }, { path: P.connTopics }],
  },
  {
    claim: "createPost sends PostCreatedEvent {creatorId, content, postId} with no key. likePost sends PostLikedEvent keyed by postId.",
    cites: [{ path: P.createPost }, { path: P.postCreatedEvent }, { path: P.likePost }, { path: P.postLikedEvent }],
  },
  {
    claim: "Both connection events are keyed by senderId. Keys go through LongSerializer, so the partitioner hashes 8 big-endian bytes.",
    cites: [{ path: P.sendRequest }, { path: P.acceptRequest }, { path: P.postsSerializer }, { path: P.connSerializer }],
  },
  {
    claim:
      "One consumer group, group-id ${spring.application.name} = notification-service, with four @KafkaListener methods. No concurrency is set, so each method is one consumer per instance.",
    cites: [{ path: P.groupId }, { path: P.deserializers }, { path: P.postsListeners }, { path: P.connListeners }],
  },
  {
    claim:
      "handlePostCreated makes a synchronous Feign call to GET /connections/core/first-degree for every event, then inserts one Notification row per connection. That is the coupling the latency control exercises.",
    cites: [{ path: P.feignCall }, { path: P.feignClient }, { path: P.sendNotification }],
  },
  {
    claim: "The connection graph uses the repository's own Cypher: an undirected one-hop CONNECTED_TO match, and DELETE r CREATE (p1)-[:CONNECTED_TO]->(p2) on accept.",
    cites: [{ path: P.firstDegree }, { path: P.addConnection }, { path: P.acceptCheck, label: "accept direction check" }],
  },
  {
    claim:
      "The repo configures no error handler, retry, or dead-letter topic. The services use the Spring Boot 4.0.1 parent and spring-boot-starter-kafka, which bring Spring Kafka 4.0.1 and kafka-clients 4.1.1, so the defaults below apply.",
    cites: [{ path: P.bootParent }, { path: P.kafkaStarter }],
  },
];

const UPSTREAM: { claim: string; href: string; label: string }[] = [
  {
    claim: "With no error handler bean, the listener container creates new DefaultErrorHandler().",
    href: "https://github.com/spring-projects/spring-kafka/blob/v4.0.1/spring-kafka/src/main/java/org/springframework/kafka/listener/KafkaMessageListenerContainer.java#L1054",
    label: "KafkaMessageListenerContainer.java:1054",
  },
  {
    claim: "Its back-off is FixedBackOff(0, 9): 10 attempts with no delay. Then the default recoverer logs the record and it is skipped.",
    href: "https://github.com/spring-projects/spring-kafka/blob/v4.0.1/spring-kafka/src/main/java/org/springframework/kafka/listener/SeekUtils.java#L63",
    label: "SeekUtils.java:63",
  },
  {
    claim: "The container commits offsets after each poll's records are processed (AckMode.BATCH).",
    href: "https://github.com/spring-projects/spring-kafka/blob/v4.0.1/spring-kafka/src/main/java/org/springframework/kafka/listener/ContainerProperties.java#L224",
    label: "ContainerProperties.java:224",
  },
  {
    claim: "Keyed records go to toPositive(murmur2(keyBytes)) % partitions. The lab's TypeScript port is tested against this exact code.",
    href: "https://github.com/apache/kafka/blob/4.1.1/clients/src/main/java/org/apache/kafka/clients/producer/internals/BuiltInPartitioner.java#L329",
    label: "BuiltInPartitioner.java:329",
  },
  {
    claim: "Unkeyed records stay on one partition until batch.size bytes have been produced to it, then switch.",
    href: "https://github.com/apache/kafka/blob/4.1.1/clients/src/main/java/org/apache/kafka/clients/producer/internals/BuiltInPartitioner.java#L223",
    label: "BuiltInPartitioner.java:223",
  },
  {
    claim: "The consumer's default assignment strategy is [RangeAssignor, CooperativeStickyAssignor], so the group uses range and the eager protocol.",
    href: "https://github.com/apache/kafka/blob/4.1.1/clients/src/main/java/org/apache/kafka/clients/consumer/ConsumerConfig.java#L452",
    label: "ConsumerConfig.java:452",
  },
  {
    claim: "A crashed consumer is only noticed after session.timeout.ms, 45 s by default.",
    href: "https://github.com/apache/kafka/blob/4.1.1/clients/src/main/java/org/apache/kafka/clients/consumer/ConsumerConfig.java#L440-L442",
    label: "ConsumerConfig.java:440-442",
  },
];

export default function KafkaLabPage() {
  const project = getProject("linkedin-clone");
  if (!project) notFound();
  const { repo } = project.links;
  const branch = project.repoBranch;
  const sourceBase = `${repo}/blob/${branch}`;
  const file = (path: string) => path.replace(/^.*\//, "");

  return (
    <Container wide className="py-10 sm:py-14">
      <header data-arch="KafkaLabIntro" data-arch-kind="server" className="max-w-[780px]">
        <SectionHeader
          as="h1"
          eyebrow={`Lab · ${project.name} · Simulation`}
          title={title}
          lede="This models the event flow of my LinkedIn clone with the names from its code. Posts and connection requests go to four Kafka topics, and one notification-service consumer group turns them into notification rows. Scale that group, crash an instance, or slow down connections-service, and watch what happens to partitions, offsets and lag."
        />
        <p className="mt-4 text-[14px] text-text-3">
          Things to try: press + and watch the stop-the-world rebalance. Set connections-service to Slow and only post-created lag grows. Add instances
          and it shrinks, up to three, because a fourth gets no partition. Set it to Down and every new post&apos;s notifications are dropped after 10
          attempts. Crash consumer 2 and its partitions stall until the session timeout, then anything it processed without committing is delivered again.
        </p>
        <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[14px]">
          <TextLink href={`/work/${project.slug}`}>Read the case study</TextLink>
          <TextLink href={repo}>Source on GitHub</TextLink>
          <TextLink href="/labs">All labs</TextLink>
        </p>
      </header>

      <div className="mt-8">
        <KafkaLab sourceBase={sourceBase} />
      </div>

      <section aria-labelledby="kafka-real-title" data-arch="KafkaLabSources" data-arch-kind="server" className="mt-12 max-w-[920px]">
        <h2 id="kafka-real-title" className="font-display text-[1.6rem] font-extrabold leading-tight tracking-[-0.01em] text-text [font-stretch:112%]">
          What&apos;s real here
        </h2>
        <p className="mt-2 max-w-[68ch] text-text-2">
          Every name in the lab comes from the repository. The behaviour comes from the framework defaults the code ends up with, because it overrides none of
          them. Timings, traffic and the six users are invented.
        </p>

        <MonoLabel as="p" className="mt-7">
          From the LinkedIn clone
        </MonoLabel>
        <ol className="mt-2 border-t border-line">
          {REAL_ITEMS.map((item) => (
            <li key={item.claim} className="grid gap-1.5 border-b border-line py-3.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] sm:gap-6">
              <p className="text-[15px] text-text">{item.claim}</p>
              <ul className="flex flex-col">
                {item.cites.map((c) => (
                  <li key={c.path} className="min-w-0 font-mono text-[12px]">
                    <a
                      href={evidenceUrl(repo, branch, c.path)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block break-all py-1 text-link underline decoration-link/30 underline-offset-[3px] hover:decoration-link"
                    >
                      {file(c.path)}
                    </a>
                    {c.label ? <span className="text-text-3"> · {c.label}</span> : null}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>

        <MonoLabel as="p" className="mt-8">
          Framework defaults at the versions the code resolves to
        </MonoLabel>
        <ol className="mt-2 border-t border-line">
          {UPSTREAM.map((u) => (
            <li key={u.href} className="grid gap-1.5 border-b border-line py-3.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] sm:gap-6">
              <p className="text-[15px] text-text">{u.claim}</p>
              <p className="min-w-0 font-mono text-[12px]">
                <a
                  href={u.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all text-link underline decoration-link/30 underline-offset-[3px] hover:decoration-link"
                >
                  {u.label}
                </a>
              </p>
            </li>
          ))}
        </ol>

        <p className="mt-6 max-w-[68ch] text-[14px] text-text-3">
          Not modelled: with a slow enough Feign call, a 500-record poll can outlast max.poll.interval.ms (5 minutes) and push the consumer out of the group,
          which causes another rebalance. The lab keeps polls small, so that never happens here.
        </p>
      </section>
    </Container>
  );
}
