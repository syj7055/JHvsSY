export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{
        backgroundColor: '#C8B5A2', /* 요청하신 배경색 */
        fontFamily: 'Arial, Helvetica, sans-serif', /* 깔끔하고 세련된 기본 폰트 */
        margin: 0,
        padding: 0,
        minHeight: '100vh',
        color: '#333'
      }}>
        {children}
      </body>
    </html>
  );
}