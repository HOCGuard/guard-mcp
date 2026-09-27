import Script from 'next/script';
import { Inter } from 'next/font/google';
import { GoogleAnalytics } from '@next/third-parties/google';

const inter = Inter({ subsets: ['latin'] });

// Hotjar desativado em dev: static.hotjar.com
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={inter.className}>
      <body>
        {children}
        <Script id="fb" strategy="afterInteractive">{`
          !function(f,b,e,v,n,t,s){n=f.fbq=function(){};t=b.createElement(e);
          t.src='https://connect.facebook.net/en_US/fbevents.js'}(window,document,'script');
          fbq('init', '123456');
        `}</Script>
        <GoogleAnalytics gaId="G-ABC123" />
      </body>
    </html>
  );
}
