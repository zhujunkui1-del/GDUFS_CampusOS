import { CampusShell } from "@/components/campus-shell";

export default function CampusLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <CampusShell>{children}</CampusShell>;
}
