import { generateToken } from "@/lib/token";
import HomeClient from "@/components/HomeClient";

export default function Home() {
  const token = generateToken();
  return <HomeClient token={token} />;
}
