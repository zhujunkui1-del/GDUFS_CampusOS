/** Recognize whole conversational turns, never strip words out of substantive questions. */
export function dialogueReply(message: string): string | undefined {
  const s = message.trim().replace(/[!！。？，?,\s]/g, "");
  if (
    /^(?:操你妈|草你妈|你妈的|傻逼|垃圾|我真服了|我真鸡巴服了|你这回答什么东西|你这答了个鸡巴啥呀)$/.test(
      s,
    )
  )
    return "刚才的回答没有解决问题。我会依据实际查询结果纠正，不把你的反馈当成新的检索主题。";
  if (/^(?:666+|哈哈[哈]*|好的|好|嗯|收到|谢谢你?|多谢)$/.test(s))
    return /谢谢|多谢/.test(s) ? "不客气。" : "收到。";
  if (/^(?:你好[呀啊]?|您好|hi|hello)$/i.test(s))
    return "你好，有什么校园问题需要帮忙？";
  if (
    /^(?:在忙啥呢|在忙什么|聊两句|给你小鱼干|你这条大肥鱼|今天有点困陪我聊两句)$/.test(
      s,
    )
  )
    return "我在这儿，可以陪你聊两句，也可以帮你查校园里的事。";
}
