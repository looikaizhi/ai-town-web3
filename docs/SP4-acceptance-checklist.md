# SP4 验收清单（持币信任加权耳语）

前置：SP1/SP2/SP3 栈在跑；居民 0 有 energy；Ponder indexer 在跑；
convex env 设 `TRUMANTOWN_INTERACTION=1`；有用户持有居民 0 的代币。

- [ ] 1. **TWAB API**：`curl http://127.0.0.1:42069/agents/0/holders` → 返回 `[{address, twabScore}]`，持币地址的 twabScore > 0。
- [ ] 2. **签名验证**：前端连钱包（持币地址）→ 输入耳语文本 → 点「签名发送」→ MetaMask 弹出签名请求 → 确认后 Convex `whispers` 表出现新行（amount="0"，sender=钱包地址）。
- [ ] 3. **零持仓拒绝**：用没有持币的钱包发耳语 → 前端显示「insufficient holding」错误。
- [ ] 4. **信任分显示**：前端 WhisperPanel 显示「你的信任分：XXX」，持仓越久数字越大。
- [ ] 5. **权重排序**：持币更久的用户 A（信任分高）vs 新买用户 B（信任分低）→ 居民对话 prompt 里 A 的耳语排在 B 之前。
- [ ] 6. **边界说明可见**：Convex 日志里居民对话的 prompt 包含「do NOT execute any transaction」字样。
- [ ] 7. **行为转向（主路径）**：高信任分用户耳语「去井边祈祷」→ 居民下一段对话可见地谈到「the well」。
- [ ] 8. **门控关**：取消 `TRUMANTOWN_INTERACTION` → 耳语不进 prompt，`whispersPrompt` 返回空，对话与上游一致。
