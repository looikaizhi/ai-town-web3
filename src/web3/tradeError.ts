// Pure: map a wagmi/viem error-ish object to a clear, actionable Chinese message.
export function humanizeTradeError(e: { shortMessage?: string; message?: string } | unknown): string {
  const raw =
    (e as any)?.shortMessage ?? (e as any)?.message ?? (typeof e === 'string' ? e : '');
  const m = String(raw).toLowerCase();
  if (m.includes('user rejected') || m.includes('user denied')) return '你取消了交易';
  if (m.includes('slippage')) return '滑点过大，调高容忍度或减小金额';
  if (m.includes('no real reserve') || m.includes('sold out')) return '当前无法卖出（曲线储备不足）';
  if (m.includes('insufficient') || m.includes('exceeds balance')) return 'USDC 余额不足';
  if (m.includes('chain') && m.includes('match')) return '请切换到 Base Sepolia 网络';
  return '交易失败，请重试';
}
