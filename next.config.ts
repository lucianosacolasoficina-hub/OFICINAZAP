import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Bibliotecas de e-mail (IMAP/SMTP) rodam só no servidor, sem passar pelo empacotador.
  serverExternalPackages: ["imapflow", "mailparser", "nodemailer"],
};

export default nextConfig;
