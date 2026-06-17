export type RivalryIntent =
  | { type: 'BUY_RIVAL'; targetId: string; usdcAmount: string }
  | { type: 'WHISPER_RIVAL'; targetId: string; amount: string; text: string }
  | { type: 'PROPOSE_ALLIANCE'; targetId: string; message: string }
  | { type: 'ACCEPT_ALLIANCE'; proposerId: string }
  | { type: 'DISSOLVE_ALLIANCE'; peerId: string };

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`${name}="([^"]+)"`));
  return m ? m[1] : null;
}

/**
 * 从 LLM 对话文本里提取博弈行动意图标记。
 * 标记格式：<rivalry:ACTION_TYPE attr1="v1" attr2="v2"/>
 * 返回 null 表示对话里没有行动意图（普通对话）。
 */
export function parseRivalryIntent(text: string): RivalryIntent | null {
  const m = text.match(/<rivalry:([A-Z_]+)([^/]*)\/?>/);
  if (!m) return null;
  const [, actionType, attrStr] = m;

  switch (actionType) {
    case 'BUY_RIVAL': {
      const targetId = attr(attrStr, 'targetId');
      const usdcAmount = attr(attrStr, 'usdcAmount');
      if (!targetId || !usdcAmount) return null;
      return { type: 'BUY_RIVAL', targetId, usdcAmount };
    }
    case 'WHISPER_RIVAL': {
      const targetId = attr(attrStr, 'targetId');
      const amount = attr(attrStr, 'amount');
      const text = attr(attrStr, 'text');
      if (!targetId || !amount || !text) return null;
      return { type: 'WHISPER_RIVAL', targetId, amount, text };
    }
    case 'PROPOSE_ALLIANCE': {
      const targetId = attr(attrStr, 'targetId');
      const message = attr(attrStr, 'message');
      if (!targetId || !message) return null;
      return { type: 'PROPOSE_ALLIANCE', targetId, message };
    }
    case 'ACCEPT_ALLIANCE': {
      const proposerId = attr(attrStr, 'proposerId');
      if (!proposerId) return null;
      return { type: 'ACCEPT_ALLIANCE', proposerId };
    }
    case 'DISSOLVE_ALLIANCE': {
      const peerId = attr(attrStr, 'peerId');
      if (!peerId) return null;
      return { type: 'DISSOLVE_ALLIANCE', peerId };
    }
    default:
      return null;
  }
}
