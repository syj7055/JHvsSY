import { Inter } from 'next/font/google';

// 구글 폰트 불러오기
const inter = Inter({ subsets: ['latin'] });

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={inter.className} style={{
        backgroundColor: '#C8B5A2', 
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