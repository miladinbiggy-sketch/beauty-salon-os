import { pushLineMessage } from "./line-delivery.js";
import { DateTime} from "luxon";
import { BUSINESS_TIMEZONE, type NotificationType} from "@salon/shared";

/**
* 通知发送层。
* - LINE：配置了 LINE_CHANNEL_ACCESS_TOKEN 时调用真实 Messaging API；
* 未配置而任务 channel=line 时明确失败（记录原因），绝不假装已送达。
* - mock：本地/未接入渠道时的模拟发送，只写日志与任务状态，管理端可见 channel=mock。
*/

export interface NotificationPayload {
bookingCode?: string;
customerName?: string;
staffName?: string;
storeName?: string;
startAt?: string;
services?: { nameZh: string; nameJa: string}[];
totalPriceJpy?: number;
}

export interface JobLike {
id: string;
type: string;
channel: string;
recipient: string | null;
payload: unknown;
}

function fmtWhen(iso?: string): { ja: string; zh: string} {
if (!iso) return { ja: "", zh: ""};
const dt = DateTime.fromISO(iso, { zone: BUSINESS_TIMEZONE});
if (!dt.isValid) return { ja: iso, zh: iso};
return {
ja: dt.toFormat("M月d日（ccc） HH:mm", { locale: "ja"}),
zh: dt.toFormat("M月d日 HH:mm", { locale: "zh-CN"}),
};
}

/** 渲染双语通知文案（日文为主、中文附注，符合在日华人店的实际客群） */
export function renderMessage(job: JobLike): string {
const p = (job.payload?? {}) as NotificationPayload;
const when = fmtWhen(p.startAt);
const servicesJa = (p.services?? []).map((s) => s.nameJa).join("、");
const servicesZh = (p.services?? []).map((s) => s.nameZh).join("、");
const price = p.totalPriceJpy!= null? `¥${p.totalPriceJpy.toLocaleString("ja-JP")}`: "";
const head: Record<NotificationType, [string, string]> = {
booking_created: ["【ご予約確定】", "【预约成功】"],
booking_cancelled: ["【ご予約キャンセル】", "【预约已取消】"],
booking_rescheduled: ["【ご予約日時の変更】", "【预约时间已变更】"],
reminder_1day: ["【明日のご予約のご案内】", "【明日预约提醒】"],
reminder_3hours: ["【ご予約3時間前のご案内】", "【预约前3小时提醒】"],
};
const [jaTitle, zhTitle] = head[job.type as NotificationType]?? ["", ""];
const lines = [
jaTitle,
p.storeName? `店舗：${p.storeName}`: "",
when.ja? `日時：${when.ja}`: "",
servicesJa? `メニュー：${servicesJa}`: "",
p.staffName? `担当：${p.staffName}`: "",
price? `金額：${price}`: "",
p.bookingCode? `予約コード：${p.bookingCode}`: "",
"",
`${zhTitle} ${when.zh} ${servicesZh}`.trim(),
];
return lines.filter((l) => l!== "").join("\n");
}

export interface SendResult {
provider: "line" | "mock";
detail: string;
}

export interface Sender {
send(job: JobLike, text: string): Promise<SendResult>;
}

export class LineSender implements Sender {
  constructor(private readonly accessToken: string | undefined) {}
  async send(job: JobLike, text: string): Promise<SendResult> {
    return pushLineMessage(job.id, job.recipient, text, this.accessToken);
  }
}

export class MockSender implements Sender {
  async send(job: JobLike, _text: string): Promise<SendResult> {
    // Never write customer's phone, name, booking code, services or care notes
    // into production logs, even when LINE is not configured.
    console.log(`[mock-notify] job=${job.id} type=${job.type} not delivered`);
    return { provider: "mock", detail: "mock delivery (no real provider configured for this channel)" };
  }
}

/** 按任务 channel 选择发送器：line 走 LINE（无 token 会抛错），其余走 mock 并明确标注 */
export function senderFor(job: JobLike, lineToken: string | undefined): Sender {
if (job.channel === "line") return new LineSender(lineToken);
return new MockSender();
}
