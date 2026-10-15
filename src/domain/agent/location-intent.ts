export function requestsDeviceLocation(message: string) {
  return /我的位置|当前位置|我现在(?:所在)?的位置|从我这[里儿]?|我身边|我附近|我在哪[里儿]?/.test(
    message,
  );
}
