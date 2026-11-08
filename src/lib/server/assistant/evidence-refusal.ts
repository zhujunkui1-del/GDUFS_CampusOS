/**
 * A refusal is an answer that asserts nothing about the corpus, so it cannot
 * carry [n] citations. The model writes refusals in two shapes:
 *
 *   “本鱼没有检索到能回答这个问题的正文信息。”
 *   “本轮检索到的资料里没有提到校医院预约的规则。”
 *
 * Both are honest; only the first used to be recognised, which made every
 * second-shape refusal burn both repair rounds and fail the run as
 * MODEL_SERVICE_UNAVAILABLE.
 */
export function admitsNoEvidence(text: string) {
  return (
    /(?:没有|未|暂未|未能|无法|未见)(?:检索到|查到|找到)/.test(text) ||
    /(?:资料|文章|正文)[^。\n]{0,40}(?:没有|未)[^。\n]{0,15}(?:提到|涉及|包含|说明|写明|规定|覆盖|信息|内容)/.test(
      text,
    )
  );
}
