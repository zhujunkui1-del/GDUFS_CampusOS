# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: assistant-failures.spec.ts >> a claimed Baiyun action switches campus and waits for its camera receipt
- Location: tests\e2e\assistant-failures.spec.ts:329:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('.baiyun-workspace .place-details-heading')
Expected substring: "第二教学楼"
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toContainText" locator('.baiyun-workspace .place-details-heading') with timeout 5000ms
  - waiting for locator('.baiyun-workspace .place-details-heading')

```

```yaml
- link "跳到主要内容":
  - /url: "#main-content"
- complementary "侧边栏":
  - link "广外通 CampusOS 首页":
    - /url: /map
  - navigation "桌面主导航":
    - link "校园地图":
      - /url: /map
    - link "校园雷达":
      - /url: /radar
    - link "校园知识":
      - /url: /knowledge
    - link "活动日历":
      - /url: /calendar
    - link "收藏与待办":
      - /url: /account/favorites
    - button "展开导航"
    - link "我的账号":
      - /url: /account
      - text: 游客
- main:
  - region "白云山校区地图":
    - region "Map"
    - button "查看第二教学楼": 第二教学楼
    - button "查看第一教学楼": 第一教学楼
    - button "查看行政办公楼": 行政办公楼
    - button "查看第三教学楼": 第三教学楼
    - button "查看第四教学楼": 第四教学楼
    - button "查看招待所": 招待所
    - button "查看文化广场": 文化广场
    - button "查看40栋": 40栋
    - button "查看广外西门": 广外西门
    - button "查看第五教学楼": 第五教学楼
    - button "查看35栋": 35栋
    - button "查看36栋/校保卫处": 36栋/校保卫处
    - link "广外通 CampusOS":
      - /url: /map
    - group "选择校区":
      - button "大学城校区"
      - button "白云山校区" [pressed]
    - text: 搜索校园地点
    - textbox "搜索校园地点":
      - /placeholder: 搜索地点、宿舍、体育设施
    - link "我的账号，当前为游客":
      - /url: /account
    - button "访问量"
    - button "留言区"
    - button "定位我的位置"
    - button "地图模式，当前2D" [disabled]: 2D
    - button "地图朝北"
    - button "查看全校区"
    - button "地图图层"
    - button "校园步行导航"
    - button "放大地图"
    - button "缩小地图"
    - dialog "第二教学楼":
      - paragraph: 白云山校区 · 校园建筑
      - button "关闭地点详情"
      - heading "第二教学楼" [level=2]
      - button "选择导航终点"
      - paragraph: 暂无图片
      - region "活动":
        - heading "活动" [level=3]
        - paragraph: 暂无活动
    - link "© OpenStreetMap contributors · ODbL":
      - /url: https://www.openstreetmap.org/copyright
- dialog "定位白云山第二教学楼":
  - button "历史对话"
  - heading "定位白云山第二教学楼" [level=2]
  - button "新对话"
  - button "收起校园助理"
  - paragraph: 校园地点与步行路线助手
  - log "校园助理对话": 定位白云山第二教学楼
  - text: 向校园助理提问
  - textbox "向校园助理提问":
    - /placeholder: 问政策、活动、地点或路线…
  - button "发送消息" [disabled]
  - button "智能搜索"
- alert
```

# Test source

```ts
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
  376 |   expect((await receipt).postDataJSON().ok).toBe(true);
  377 |   await expect(page.getByTestId("baiyun-map")).toHaveAttribute(
  378 |     "data-camera-moving",
  379 |     "false",
  380 |   );
  381 |   await expect(
  382 |     page.locator(".baiyun-workspace .place-details-heading"),
> 383 |   ).toContainText("第二教学楼");
      |     ^ Error: expect(locator).toContainText(expected) failed
  384 | });
  385 | 
```