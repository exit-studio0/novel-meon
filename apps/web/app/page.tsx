import Workbench from "@/components/workbench/workbench";
import { getUserSettings } from '@/services/settings';
import { redirect } from 'next/navigation';

export default async function Page() {
  const settings = await getUserSettings();

  // 如果未登录，重定向回主站的首页
  if (!settings) {
     redirect('https://meonai.art');
  }

  return <Workbench user={settings} />;
}
