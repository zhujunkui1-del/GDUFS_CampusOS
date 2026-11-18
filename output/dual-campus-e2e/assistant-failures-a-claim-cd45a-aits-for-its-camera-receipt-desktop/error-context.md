# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: assistant-failures.spec.ts >> a claimed Baiyun action switches campus and waits for its camera receipt
- Location: tests\e2e\assistant-failures.spec.ts:329:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic:
    - link "跳到主要内容" [ref=e2] [cursor=pointer]:
      - /url: "#main-content"
    - complementary "侧边栏" [ref=e3]:
      - link "广外通 CampusOS 首页" [ref=e4] [cursor=pointer]:
        - /url: /map
      - navigation "桌面主导航" [ref=e6]:
        - generic [ref=e7]:
          - link "校园地图" [ref=e8] [cursor=pointer]:
            - /url: /map
            - generic [aria-hidden]: 地图
          - link "校园雷达" [ref=e11] [cursor=pointer]:
            - /url: /radar
            - generic [aria-hidden]: 雷达
          - link "校园知识" [ref=e19] [cursor=pointer]:
            - /url: /knowledge
            - generic [aria-hidden]: 知识
          - link "活动日历" [ref=e22] [cursor=pointer]:
            - /url: /calendar
            - generic [aria-hidden]: 日历
          - link "收藏与待办" [ref=e25] [cursor=pointer]:
            - /url: /account/favorites
            - generic [aria-hidden]: 收藏
        - generic [ref=e28]:
          - button "展开导航" [ref=e29] [cursor=pointer]
          - link "我的账号" [ref=e33] [cursor=pointer]:
            - /url: /account
            - generic [ref=e38]: 游客
    - main:
      - region "白云山校区地图":
        - generic "白云山校区本地地图" [ref=e39]:
          - generic:
            - region "Map" [ref=e40]
            - button "查看第二教学楼" [ref=e41] [cursor=pointer]: 第二教学楼
            - button "查看第一教学楼" [ref=e42] [cursor=pointer]: 第一教学楼
            - button "查看行政办公楼" [ref=e43] [cursor=pointer]: 行政办公楼
            - button "查看第四教学楼" [ref=e44] [cursor=pointer]: 第四教学楼
            - button "查看第三教学楼" [ref=e45] [cursor=pointer]: 第三教学楼
            - button "查看招待所" [ref=e46] [cursor=pointer]: 招待所
            - button "查看文化广场" [ref=e47] [cursor=pointer]: 文化广场
            - button "查看40栋" [ref=e48] [cursor=pointer]: 40栋
            - button "查看广外西门" [ref=e49] [cursor=pointer]: 广外西门
            - button "查看第五教学楼" [ref=e50] [cursor=pointer]: 第五教学楼
            - button "查看35栋" [ref=e51] [cursor=pointer]: 35栋
            - button "查看36栋/校保卫处" [ref=e52] [cursor=pointer]: 36栋/校保卫处
        - generic [ref=e53]:
          - generic [ref=e54]:
            - link "广外通 CampusOS" [ref=e55] [cursor=pointer]:
              - /url: /map
              - text: 广外通
              - generic [ref=e56]: CampusOS
            - group "选择校区" [ref=e57]:
              - button "大学城校区" [ref=e59] [cursor=pointer]
              - button "白云山校区" [pressed] [ref=e60] [cursor=pointer]
          - generic [ref=e62]:
            - generic [ref=e66]: 搜索校园地点
            - textbox "搜索校园地点" [ref=e67]:
              - /placeholder: 搜索地点、宿舍、体育设施
        - link "我的账号，当前为游客" [ref=e68] [cursor=pointer]:
          - /url: /account
        - button "访问量" [ref=e72] [cursor=pointer]
        - button "留言区" [ref=e75] [cursor=pointer]
        - generic "地图工具" [ref=e78]:
          - button "定位我的位置" [ref=e79] [cursor=pointer]
          - button "地图模式，当前2D" [disabled] [ref=e83]: 2D
          - button "地图朝北" [ref=e84] [cursor=pointer]
          - button "查看全校区" [ref=e88] [cursor=pointer]
          - button "地图图层" [ref=e92] [cursor=pointer]
          - button "校园步行导航" [ref=e97] [cursor=pointer]
          - button "放大地图" [ref=e101] [cursor=pointer]
          - button "缩小地图" [ref=e103] [cursor=pointer]
        - dialog [ref=e106]:
          - generic [ref=e107]:
            - generic [ref=e108]:
              - paragraph [ref=e109]: 白云山校区 · 校园建筑
              - button "关闭地点详情" [active] [ref=e110] [cursor=pointer]
            - generic [ref=e114]:
              - generic [ref=e115]:
                - heading "第二教学楼" [level=2] [ref=e116]
                - button "选择导航终点" [ref=e117] [cursor=pointer]
              - generic [ref=e120]:
                - paragraph [ref=e121]: 暂无图片
                - region "活动" [ref=e122]:
                  - heading "活动" [level=3] [ref=e124]
                  - paragraph [ref=e125]: 暂无活动
        - link "© OpenStreetMap contributors · ODbL" [ref=e128] [cursor=pointer]:
          - /url: https://www.openstreetmap.org/copyright
    - dialog [ref=e129]:
      - generic [ref=e130]:
        - generic [ref=e131]:
          - generic [ref=e132]:
            - button "历史对话" [ref=e133] [cursor=pointer]
            - heading "定位白云山第二教学楼" [level=2] [ref=e138]
          - generic [ref=e139]:
            - button "新对话" [ref=e140] [cursor=pointer]
            - button "收起校园助理" [ref=e144] [cursor=pointer]
        - generic [ref=e148]:
          - paragraph [ref=e149]: 校园地点与步行路线助手
          - log "校园助理对话" [ref=e150]:
            - generic [ref=e151]: 定位白云山第二教学楼
          - status [ref=e153]: 正在调整地图…
        - generic [ref=e154]:
          - generic [ref=e155]:
            - generic [ref=e156]: 向校园助理提问
            - textbox "向校园助理提问" [ref=e157]:
              - /placeholder: 问政策、活动、地点或路线…
            - button "停止回复" [ref=e158] [cursor=pointer]
          - button "智能搜索" [disabled] [ref=e162]
  - alert [ref=e166]
```

# Test source

```ts
  276 |         release = resolve;
  277 |       });
  278 |       const event = (type: string, payload: unknown, n: number) =>
  279 |         `data: ${JSON.stringify({ runId, eventId: runId + ":" + n, timestamp: new Date().toISOString(), type, payload })}\n\n`;
  280 |       await route.fulfill({
  281 |         contentType: "text/event-stream",
  282 |         body:
  283 |           event(
  284 |             "artifact.ready",
  285 |             {
  286 |               cards: [],
  287 |               routes: [],
  288 |               packet: { id: packetId, actions: [action] },
  289 |             },
  290 |             1,
  291 |           ) + event("run.completed", {}, 2),
  292 |       });
  293 |     });
  294 |     await page.getByLabel("向校园助理提问").fill("找南苑7栋");
  295 |     await page.getByLabel("向校园助理提问").press("Enter");
  296 |     await expect.poll(() => typeof release).toBe("function");
  297 |     await page.getByRole("button", { name: "收起校园助理" }).click();
  298 |     if (change === "tag")
  299 |       await page
  300 |         .getByRole("button", { name: "查看图书馆", exact: true })
  301 |         .click();
  302 |     else if (change === "zoom")
  303 |       await page.getByRole("button", { name: "放大地图", exact: true }).click();
  304 |     else {
  305 |       const point = await page.evaluate(() => {
  306 |         for (let y = 180; y < innerHeight - 150; y += 50)
  307 |           for (let x = 150; x < innerWidth - 80; x += 50)
  308 |             if (
  309 |               document
  310 |                 .elementFromPoint(x, y)
  311 |                 ?.classList.contains("maplibregl-canvas")
  312 |             )
  313 |               return { x, y };
  314 |         return { x: innerWidth / 2, y: innerHeight / 2 };
  315 |       });
  316 |       await page.mouse.move(point.x, point.y);
  317 |       await page.mouse.down();
  318 |       await page.mouse.move(point.x + 35, point.y + 35, { steps: 8 });
  319 |       await page.mouse.up();
  320 |     }
  321 |     release();
  322 |     await expect(page.locator(".assistant-error")).toContainText("新的选择");
  323 |     if (change === "tag")
  324 |       await expect(page.locator(".place-details-heading")).toContainText(
  325 |         "图书馆",
  326 |       );
  327 |   });
  328 | 
  329 | test("a claimed Baiyun action switches campus and waits for its camera receipt", async ({
  330 |   page,
  331 | }) => {
  332 |   const runId = randomUUID(),
  333 |     packetId = randomUUID();
  334 |   const action = {
  335 |     type: "FOCUS_PLACE",
  336 |     campus: "baiyun",
  337 |     placeId: "osm-relation-13030162",
  338 |   };
  339 |   await page.route("**/api/agent/actions/*/claim", (route) =>
  340 |     route.fulfill({
  341 |       json: { ok: true, data: { id: packetId, actions: [action], routes: [] } },
  342 |     }),
  343 |   );
  344 |   await page.route("**/api/agent/actions/*/receipt", (route) =>
  345 |     route.fulfill({ json: { ok: true, data: { saved: true } } }),
  346 |   );
  347 |   await page.route("**/api/agent/chat", (route) => {
  348 |     expect(route.request().postDataJSON().mapContext.campus).toBe("university");
  349 |     const event = (type: string, payload: unknown, n: number) =>
  350 |       "data: " +
  351 |       JSON.stringify({
  352 |         runId,
  353 |         eventId: runId + ":" + n,
  354 |         timestamp: new Date().toISOString(),
  355 |         type,
  356 |         payload,
  357 |       }) +
  358 |       "\n\n";
  359 |     return route.fulfill({
  360 |       contentType: "text/event-stream",
  361 |       body:
  362 |         event(
  363 |           "artifact.ready",
  364 |           {
  365 |             cards: [],
  366 |             packet: { id: packetId, actions: [action] },
  367 |             routes: [],
  368 |           },
  369 |           1,
  370 |         ) + event("run.completed", {}, 2),
  371 |     });
  372 |   });
  373 |   const receipt = page.waitForRequest("**/api/agent/actions/*/receipt");
  374 |   await page.getByLabel("向校园助理提问").fill("定位白云山第二教学楼");
  375 |   await page.getByLabel("向校园助理提问").press("Enter");
> 376 |   expect((await receipt).postDataJSON().ok).toBe(true);
      |                                             ^ Error: expect(received).toBe(expected) // Object.is equality
  377 |   await expect(page.getByTestId("baiyun-map")).toHaveAttribute(
  378 |     "data-camera-moving",
  379 |     "false",
  380 |   );
  381 |   await expect(
  382 |     page.locator(".baiyun-workspace .place-details-heading"),
  383 |   ).toContainText("第二教学楼");
  384 | });
  385 | 
```