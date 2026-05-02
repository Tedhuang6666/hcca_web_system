import { convertToChineseDay } from '../../../src/ts/shared-utils';
import { getMailTemplate } from './template';

export function newMeetingNotice(id: string, subject: string, user: string, from: string, date: Date, location: string) {
  return getMailTemplate({
    title: '您收到了開會通知單',
    titleLink: `https://law.cksc.tw/document/${id}`,
    greeting: `${user} 您好，`,
    contentLines: [
      `您收到了來自${from}的開會通知單，會議名稱「${subject}」。`,
      `會議時間：民國${date.getFullYear() - 1911}年${date.getMonth() + 1}月${date.getDate()}日 星期${convertToChineseDay(date.getDay())} ${date.getHours() + 8}時 ${date.getMinutes()}分`,
      `會議地點：${location}`,
      '煩請出席及列席人準時與會。',
    ],
    actionMessage: `若要檢視會議內容及關係文書附件，請至<a href="https://law.cksc.tw/document/${id}" rel="noopener" style="text-decoration: underline; color: #0068A5;" target="_blank">本會法律與公文系統</a>查閱。`,
    actionText: '至公文系統查閱',
    actionLink: `https://law.cksc.tw/document/${id}`,
  });
}
