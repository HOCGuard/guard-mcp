export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="pt-BR"><body>{children}<footer><a href="/politica-de-privacidade">Política de Privacidade</a></footer></body></html>;
}
