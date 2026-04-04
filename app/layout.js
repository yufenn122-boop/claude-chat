export const metadata = {
  title: "Claude Chat",
  description: "Chat with Claude",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh">
      <body style={{ margin: 0, padding: 0 }}>{children}</body>
    </html>
  );
}
