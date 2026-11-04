# 校园网访问链路排查（2026-11-04，进行中）

## 本轮边界与最新实测

负责人要求先暂存8条AI问题，不修Agent。本轮只处理网页加载；AI反馈另见[暂存清单](ASSISTANT_DEFERRED_2026_11_04.md)。

负责人确认：两个自有域名在普通Wi-Fi、手机流量及Chrome、Edge、微信中可以打开，电脑/手机的2.5D和完整3D正常。夸克和部分品牌系统浏览器不再作为阻断。**校园网直接显示无法访问网站，而非地图模型加载失败。** 当前工作站不在校园网，不能模拟其出口或据外网结果宣布修复。

因此优先区分：系统DNS解析、TCP连接、TLS/证书、HTTP访问控制及校园网认证。此时不通过改地图、Agent Prompt、超时或重试参数解决未知的网络故障。

## 已取得的只读证据

- 当前工作站系统DNS，以及向223.5.5.5/119.29.29.29的普通DNS查询，均返回198.18.*合成地址，未返回AAAA。自动/IPv4 HTTPS能取得两站HTTP200；IPv6查询失败。这只能描述当前本地解析链路，**不能推出网站没有IPv6或校园网IPv6有问题**。
- AliDNS HTTPS公开解析对两个域名均返回正常A和AAAA，且两个域名使用相同的一组Cloudflare边缘地址；见[public-dns.json](verification/campus-network-2026-11-04/public-dns.json)。不是校园网DNS实测。
- 现有Wrangler凭据读取区域设置与自定义防火墙规则分别返回403/9109、403/10000，不能凭此断言WAF没有拦截，也不能将API鉴权失败当作网站拒绝用户。回执见[cloudflare-readonly.json](verification/campus-network-2026-11-04/cloudflare-readonly.json)。未修改DNS、IPv6、WAF、证书、正式路由或Worker。
- [当前工作站对照](verification/campus-network-2026-11-04/outside-workstation.json)是非校园网结果，不包含设备/客户端IP、SSID、账号、Cookie或认证凭据。remoteAddress仅为连接的远端/本地合成目标，不是用户出口IP。

## 校园网所需的最小证据

优先取得Chrome错误页底部的`ERR_...`或`DNS_PROBE_...`代码。负责人已同意下次连接校园网时提供，当前未收到。

有校园网Windows电脑时，可运行[scripts/check-campus-connectivity.ps1](../scripts/check-campus-connectivity.ps1)，一次保存两域名DNS、自动/IPv4/IPv6 HTTPS、校方官网与QQ控制请求、脱敏响应头及耗时。只执行公开查询与GET；不跟随重定向、不禁用证书验证、不更改DNS/代理/执行策略、不采集登录或抓包。外部DNS查询不会更换设备DNS设置。

```powershell
pwsh -NoProfile -File .\scripts\check-campus-connectivity.ps1 -Label campus
```

当前PowerShell7实跑验证8条DNS/8条HTTPS，检查目标主机、导出响应头白名单和临时文件清理均通过。默认Windows PowerShell5在本机的未签名文件策略下拒绝执行，未调整该策略；不能宣称已通过PS5实跑。若设备禁止脚本，可只在PowerShell交互窗口手动执行以下原生命令，无需改执行策略：

```powershell
nslookup gdufs.ccwu.cc
nslookup map-test.gdufs.ccwu.cc
curl.exe --noproxy "*" -4 --connect-timeout 5 --max-time 10 -sS -o NUL -w "HTTP=%{http_code} total=%{time_total}s\n" https://gdufs.ccwu.cc/map
curl.exe --noproxy "*" -4 --connect-timeout 5 --max-time 10 -sS -o NUL -w "HTTP=%{http_code} total=%{time_total}s\n" https://map-test.gdufs.ccwu.cc/map
```

任何HTTP响应（包括控制请求的非200）只能证明该次连接取得HTTP响应，不自动代表页面或业务正常。脚本完成也不等于校园网验收通过。

## 判断与下一步

| 证据                                  | 下一步                                                    |
| ------------------------------------- | --------------------------------------------------------- |
| 校园DNS报错，或与可信公开解析明显不符 | 复核学校解析路径、认证状态与域名分类；不先改全站DNS。     |
| DNS有正确地址但连接超时/重置          | 比较IPv4/IPv6与控制站，确定校园出口到目标边缘的可达性。   |
| 证书错误                              | 记录错误码，核对证书链/校园TLS检查；不关HTTPS或忽略证书。 |
| HTTP403且有CF-Ray                     | 按时间与Ray在获授权的Cloudflare安全事件中核对具体规则。   |
| 学校官网可达，但其他外站/认证门户受限 | 核实校园网外网认证与出口策略。                            |

目前没有足够证据确认某一种根因，也没有发布网络配置修复。待校园网回执到达后再做针对性调整；若涉及正式DNS/路由/WAF仍遵守原授权边界。无需把已正常的地图或AI模块重新开发。
