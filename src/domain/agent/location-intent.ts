export function requestsDeviceLocation(message: string) {
  if (
    /(?:不要|不用|不必|别)(?:使用|用|获取|获取我的)?(?:我的位置|当前位置|定位)/.test(
      message,
    )
  )
    return false;
  return /我的位置|当前位置|我现在(?:所在)?的位置|从我这[里儿]?|我身边|我附近|我在哪[里儿]?/.test(
    message,
  );
}
