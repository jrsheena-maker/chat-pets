import { ThirdwebProvider } from "thirdweb/react";
import "./globals.css";

export const metadata = {
  title: "Community-Kreaturen",
  description: "Claime dein Ei und lass es wachsen",
};

export default function RootLayout({ children }) {
  return (
    <html lang="de">
      <body>
        {/* ThirdwebProvider macht den Login/Wallet-Dienst auf der ganzen Seite verfügbar */}
        <ThirdwebProvider>{children}</ThirdwebProvider>
      </body>
    </html>
  );
}
