import { Nav } from "@/components/Nav";

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="shell">
      <Nav />
      <main className="main">{children}</main>
    </div>
  );
}
