import { test, expect } from "@playwright/test";
import { selectMapMode } from "./helpers/map-mode";

test("cold mode switch never displays the old South 7 extrusion",async({page})=>{
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route(/\/models\/.*\.glb(?:\?|$)/,async route=>{await gate;await route.continue().catch(()=>undefined);});
  try{
    await page.goto("/map?place=osm-way-312536955",{waitUntil:"domcontentloaded"});
    const map=page.getByTestId("campus-map");
    await expect(map).toHaveAttribute("data-status","ready");
    await page.getByTestId("map-mode-trigger").click();
    await expect(map).toHaveAttribute("data-mode","2.5d");
    for(let i=0;i<15;i++){
      await expect(map).toHaveAttribute("data-model-native-volume","none");
      await expect(map).not.toHaveAttribute("data-model-volume-renderer","native");
      await page.waitForTimeout(30);
    }
  }finally{release();}
});

test("South 7 and adjacent dorms share cached shadows across map movement",async({page})=>{
  await page.goto("/map?place=osm-way-312536955",{waitUntil:"domcontentloaded"});
  const map=page.getByTestId("campus-map");
  await expect(map).toHaveAttribute("data-status","ready");
  await selectMapMode(page,"3D");
  await expect(map).toHaveAttribute("data-campus-model-pending","0",{timeout:60000});
  await expect(map).toHaveAttribute("data-campus-model-shadow-mode","3d");
  await expect(map).toHaveAttribute("data-model-renderer","shared");
  await expect(map).toHaveAttribute("data-model-native-volume","none");
  const casters=JSON.parse((await map.getAttribute("data-campus-model-shadow-casters"))||"[]");
  expect(casters).toContain("dormitory-s7");expect(casters).toContain("dormitory-s8");
  const updates=await map.getAttribute("data-campus-model-shadow-updates");
  await page.getByRole("button",{name:"顺时针旋转地图",exact:true}).click();
  await expect(map).toHaveAttribute("data-camera-moving","false");
  await expect(map).toHaveAttribute("data-campus-model-shadow-updates",updates!);
  await expect(map).toHaveAttribute("data-campus-model-failed","[]");
});
