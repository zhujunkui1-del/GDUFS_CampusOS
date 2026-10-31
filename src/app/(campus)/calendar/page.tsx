import { ActivityCalendar } from "@/features/calendar/activity-calendar";
import { Suspense } from "react";
export const metadata = { title: "活动日历 · 广外通 CampusOS" };
export default function CalendarPage() {
  return (
    <Suspense
      fallback={<section className="module-page">正在加载活动日历…</section>}
    >
      <ActivityCalendar />
    </Suspense>
  );
}
