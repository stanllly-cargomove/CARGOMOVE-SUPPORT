// Gmail has already accepted the email. Receipt/learning failures must never
// turn a known successful send into an automatic resend or an UNKNOWN result.
export async function recordAcceptedReply(client: any, deliveryId: string, actor: string, messageId: string) {
  try {
    const result = await client.rpc('finish_manual_reply', { p_id: deliveryId, p_actor: actor, p_gmail_message_id: messageId });
    if (!result.error) return { saved: true, learningQueued: !!result.data?.learning_queued };
    if (!['PGRST202', '42883'].includes(result.error.code)) return { saved: false, learningQueued: false };
    // Older Auto Mail databases keep working until the learning migration runs.
    const fallback = await client.from('reply_deliveries').update({ status: 'SENT', gmail_message_id: messageId, finished_at: new Date().toISOString() }).eq('id', deliveryId);
    return { saved: !fallback.error, learningQueued: false };
  } catch { return { saved: false, learningQueued: false }; }
}
