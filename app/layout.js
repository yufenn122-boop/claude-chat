export const metadata = {
  title: "Claude Chat",
  description: "Chat with Claude",
  icons: {
    icon: "https://claude.ai/favicon.ico",
    apple: "https://claude.ai/favicon.ico",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh">
      <body style={{ margin: 0, padding: 0 }}>{children}</body>
    </html>
  );
}
