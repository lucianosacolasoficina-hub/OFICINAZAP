import { Nav } from "@/components/Nav";
import { GestaoAoVivo } from "@/components/GestaoAoVivo";
import { AvisoTrava } from "@/components/TravaEnvio";

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="shell">
      <Nav />
      <GestaoAoVivo />
      <AvisoTrava />
      <main className="main">{children}</main>
    </div>
  );
}
