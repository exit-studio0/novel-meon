import Workbench from "@/components/workbench/workbench";
import { getUserSettings } from '@/services/settings';
import { redirect } from 'next/navigation';

export default async function Page() {
  const settings = await getUserSettings();

  // 如果未登录，重定向回主站的登录页
  if (!settings) {
     redirect('https://xxx.art/login?redirect=https://noval.xxx.art');
  }

  return <Workbench />;
}
