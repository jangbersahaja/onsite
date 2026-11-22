import { enSchedule } from "../en/schedule";

export const idSchedule: typeof enSchedule = {
  navigation: "Jadwal",
  page: {
    title: "Jadwal",
    subheading: "Shift terbitan Anda, mengikuti waktu outlet.",
    fallbackWorkspace: "Pencatatan waktu",
  },
  controls: {
    week: "Minggu",
    month: "Bulan",
    calendar: "Kalender",
    agenda: "Agenda",
    previousWeek: "Minggu sebelumnya",
    nextWeek: "Minggu berikutnya",
    previousMonth: "Bulan sebelumnya",
    nextMonth: "Bulan berikutnya",
    today: "Hari ini",
    jumpToDate: "Pilih tanggal",
    refresh: "Muat ulang jadwal",
    download: "Tambahkan ke kalender",
  },
  summary: {
    shifts: "Shift",
    scheduledTime: "Waktu terjadwal",
    nextShift: "Shift berikutnya",
    noneScheduled: "Tidak ada jadwal",
  },
  shift: {
    published: "Diterbitkan",
    start: "Mulai",
    end: "Selesai",
    break: "Istirahat tidak dibayar",
    paidTime: "Waktu dibayar",
    note: "Catatan shift",
    outlet: "Outlet",
    overnight: "Selesai hari berikutnya",
    openClock: "Buka Pencatatan Waktu",
    details: "Detail shift",
    close: "Tutup detail shift",
  },
  states: {
    loading: "Memuat jadwal Anda...",
    openingBackoffice: "Membuka Backoffice...",
    emptyTitle: "Tidak ada shift terbitan",
    emptyBody: "Manajer belum menerbitkan shift untuk rentang ini.",
    noOutletTitle: "Belum ada outlet",
    noOutletBody:
      "Keanggotaan outlet aktif diperlukan untuk melihat jadwal Anda.",
  },
  errors: {
    loadFailed: "Jadwal Anda tidak dapat dimuat.",
  },
};
