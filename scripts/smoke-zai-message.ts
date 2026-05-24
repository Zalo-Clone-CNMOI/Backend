/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Phase 1 smoke test for Zai end-to-end message flow.
 *
 * Publishes a single chat.ai.message Kafka event with Zai as sender. After running:
 *   1. Verify a row exists in ScyllaDB messages_by_conversation
 *   2. Verify ws-gateway broadcast was received by frontend (open browser, observe)
 *
 * Usage:
 *   KAFKA_BROKERS=<broker>:9092 \
 *   ZAI_BOT_USER_ID=00000000-0000-0000-0000-0000000000a1 \
 *   CONVERSATION_ID=<existing-conv-uuid> \
 *   npx ts-node -r tsconfig-paths/register scripts/smoke-zai-message.ts
 *
 * The CONVERSATION_ID must be an existing conversation you are a member of. Pick
 * any direct or group conversation from your own account so you can see the
 * message arrive on your frontend.
 */

import { randomUUID } from 'crypto';
import { Kafka } from 'kafkajs';

const broker = process.env.KAFKA_BROKERS;
const zaiId = process.env.ZAI_BOT_USER_ID;
const conversationId = process.env.CONVERSATION_ID;

if (!broker || !zaiId || !conversationId) {
  console.error(
    'Missing required env: KAFKA_BROKERS, ZAI_BOT_USER_ID, CONVERSATION_ID',
  );
  process.exit(1);
}

async function main() {
  const kafka = new Kafka({
    clientId: 'zai-smoke-test',
    brokers: broker!.split(','),
  });

  const producer = kafka.producer();
  await producer.connect();

  const messageId = randomUUID();
  const traceId = `smoke-${Date.now()}`;
  const body = `🤖 Zai smoke test — ${new Date().toISOString()}`;

  const payload = {
    message_id: messageId,
    conversation_id: conversationId,
    sender_id: zaiId,
    body,
    created_at: Date.now(),
    trace_id: traceId,
    metadata: { feature: 'general' as const },
  };

  console.log(`Publishing chat.ai.message to ${broker}...`);
  console.log(`  message_id      = ${messageId}`);
  console.log(`  conversation_id = ${conversationId}`);
  console.log(`  body            = ${body}`);

  await producer.send({
    topic: 'chat.ai.message',
    messages: [{ value: JSON.stringify(payload) }],
  });

  await producer.disconnect();

  console.log('\n✅ Published. Now verify:');
  console.log(
    `  1. ScyllaDB row: docker exec <scylla-container> cqlsh -e "SELECT message_id, sender_id, body FROM chat.messages_by_conversation WHERE conversation_id = ${conversationId} AND message_id = ${messageId};"`,
  );
  console.log(
    `  2. Open the frontend logged in as a member of ${conversationId} — the Zai message should appear instantly.`,
  );
  console.log(
    `  3. chat-service logs should show: "[${traceId}] Zai message persisted"`,
  );
  console.log(
    `  4. If sender_id was wrong, chat-service would log: "Rejected chat.ai.message with forged sender_id"`,
  );
}

main().catch((err) => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});
