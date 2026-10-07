import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: '映析 · 摄影拆解工作台',
  description: '从一张摄影作品，理解场景、机位、焦段、构图与 Lightroom 调色思路。',
  icons: { icon: '/favicon.svg', shortcut: '/favicon.svg' },
};
export default function RootLayout({ children }: Readonly<{children: React.ReactNode}>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
