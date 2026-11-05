import { Nav } from "@/components/Nav";
import { GestaoAoVivo } from "@/components/GestaoAoVivo";

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="shell">
      <Nav />
      <GestaoAoVivo />
      <main className="main">{children}</main>
    </div>
  );
}
