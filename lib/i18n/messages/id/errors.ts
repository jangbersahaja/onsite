import type { enErrors } from "../en/errors";

export const idErrors: typeof enErrors = {
  auth_unconfigured: "Autentikasi belum dikonfigurasi.",
  invalid_json: "Isi permintaan harus berupa JSON yang valid.",
  invalid_sign_in: "Nama pengguna/email dan kata sandi diperlukan.",
  too_many_attempts: "Terlalu banyak percobaan masuk. Coba lagi nanti.",
  invalid_credentials: "Nama pengguna/email atau kata sandi tidak dikenali.",
  pending_approval:
    "Akun Anda menunggu persetujuan admin. Silakan hubungi manajer/supervisor Anda untuk menyetujui pendaftaran.",
  pin_not_recognized: "Masuk dengan PIN tidak dikenali untuk peramban ini.",
  password_mismatch: "Kata sandi tidak cocok.",
  photo_required: "Foto profil diperlukan.",
  photo_too_large: "Foto profil harus 2 MB atau kurang.",
  register_failed: "Pendaftaran ini tidak dapat dikirim.",
  registration_link_invalid: "Tautan pendaftaran ini tidak tersedia.",
  registration_link_missing: "Tautan pendaftaran ini tidak memiliki token.",
  reset_link_invalid:
    "Tautan atur ulang ini tidak valid, sudah kedaluwarsa, atau sudah digunakan.",
  reset_link_incomplete:
    "Tautan atur ulang ini tidak valid atau tidak lengkap.",
  sign_in_failed: "Gagal masuk.",
  pin_sign_in_unconfigured:
    "Masuk dengan PIN belum dikonfigurasi di server ini.",
  invalid_pin_sign_in: "Akun yang valid dan PIN enam digit diperlukan.",
  pin_sign_in_failed: "Tidak dapat masuk dengan PIN.",
  unauthorized: "Masuk untuk melanjutkan.",
  invalid_locale: "Pilih bahasa yang didukung.",
  email_taken: "Akun dengan email ini sudah ada.",
  username_taken: "Nama pengguna ini sudah dipakai.",
  registration_rate_limited:
    "Terlalu banyak percobaan pendaftaran. Coba lagi nanti.",
  invalid_registration:
    "Nama, nama pengguna, email, kata sandi minimal 12 karakter, dan tautan yang valid diperlukan.",
  photo_invalid: "Foto profil tidak dapat divalidasi.",
  clock_unconfigured: "Atur DATABASE_URL sebelum menggunakan pencatatan jam.",
  clock_access_disabled: "Akses jam belum diaktifkan.",
  invalid_history_filters: "Filter tanggal riwayat tidak valid.",
  invalid_history_pagination: "Paginasi riwayat tidak valid.",
  timekeeping_load_failed: "Data waktu kerja tidak dapat dimuat.",
  invalid_clock_action: "Detail tindakan jam tidak valid.",
  no_open_shift: "Tidak ada shift terbuka di outlet ini.",
  break_already_open: "Shift ini sudah memiliki istirahat yang masih terbuka.",
  no_open_break: "Shift ini tidak memiliki istirahat terbuka untuk diakhiri.",
  outlet_not_assigned: "Anda tidak ditugaskan ke outlet ini.",
  staff_device_not_approved:
    "Peramban ini belum disetujui untuk tindakan jam staf.",
  location_accuracy_low:
    "Akurasi lokasi terlalu rendah. Ajukan koreksi waktu manual kepada kepala outlet Anda.",
  outside_clock_radius:
    "Lokasi Anda tidak dapat diverifikasi dalam radius pencatatan jam outlet ini. Ajukan koreksi waktu manual jika perlu.",
  outlet_not_found: "Outlet tidak ditemukan.",
  already_clocked_in: "Anda sudah memiliki shift yang terbuka.",
  end_break_first: "Akhiri istirahat Anda sebelum mencatat jam pulang.",
  clock_action_failed: "Tindakan jam tidak dapat dicatat.",
  corrections_unconfigured: "Atur DATABASE_URL sebelum menggunakan koreksi.",
  correction_review_unavailable: "Akses tinjauan koreksi tidak tersedia.",
  outlet_access_denied: "Anda tidak dapat mengakses outlet ini.",
  corrections_load_failed: "Permintaan koreksi tidak dapat dimuat.",
  invalid_decision: "Detail keputusan tidak valid.",
  correction_not_found: "Koreksi yang diterapkan tidak ditemukan.",
  related_shift_missing: "Shift terkait tidak lagi ada.",
  future_time_reconcile: "Waktu di masa mendatang tidak dapat disesuaikan.",
  adjusted_punch_out_of_order:
    "Catatan waktu yang disesuaikan akan membuat shift tidak berurutan.",
  adjusted_clock_in_overlaps:
    "Waktu masuk yang disesuaikan tumpang tindih dengan shift lain.",
  correction_not_awaiting: "Koreksi ini tidak lagi menunggu rekonsiliasi.",
  correction_review_failed: "Permintaan koreksi tidak dapat ditinjau.",
  invalid_correction: "Detail permintaan koreksi tidak valid.",
  clock_out_shift_required: "Pilih shift yang memerlukan koreksi jam pulang.",
  requested_time_future: "Waktu yang diminta tidak boleh di masa depan.",
  shift_not_owned: "Shift itu bukan milik akun Anda.",
  break_not_found: "Istirahat itu tidak lagi ada di shift ini.",
  break_end_locked:
    "Istirahat yang masih terbuka hanya bisa dikoreksi waktu mulainya.",
  break_in_future: "Waktu istirahat tidak boleh di masa depan.",
  break_invalid:
    "Waktu istirahat harus berada dalam shift dan tidak boleh tumpang tindih dengan istirahat lain.",
  break_shift_required: "Pilih shift yang berisi istirahat itu.",
  break_not_adjustable: "Istirahat yang dihapus hanya bisa dikonfirmasi.",
  requested_punch_out_of_order:
    "Catatan waktu yang diminta akan membuat shift tidak berurutan.",
  requested_clock_in_overlaps:
    "Waktu masuk yang diminta tumpang tindih dengan shift lain.",
  shift_update_failed: "Shift tidak dapat diperbarui.",
  correction_submit_failed: "Permintaan koreksi tidak dapat dikirim.",
  device_review_unavailable: "Akses tinjauan perangkat tidak tersedia.",
  outlet_not_available: "Outlet tidak tersedia.",
  device_status_failed: "Status perangkat tepercaya tidak dapat dimuat.",
  device_request_pending:
    "Permintaan perangkat sudah menunggu persetujuan manajer.",
  device_request_failed: "Permintaan perangkat tepercaya tidak dapat dikirim.",
  team_access_denied: "Akses tim ditolak.",
  invalid_device_action: "Tindakan perangkat yang valid diperlukan.",
  device_manage_denied: "Anda tidak dapat mengelola perangkat ini.",
  own_device_manage_denied:
    "Anda tidak dapat mengelola perangkat tepercaya Anda sendiri.",
  approve_requires_pending:
    "Hanya perangkat yang menunggu yang dapat disetujui.",
  reject_requires_pending: "Hanya perangkat yang menunggu yang dapat ditolak.",
  revoke_requires_active: "Hanya perangkat aktif yang dapat dicabut.",
  device_status_changed:
    "Status perangkat telah berubah. Muat ulang dan coba lagi.",
  device_update_failed: "Perangkat tepercaya tidak dapat diperbarui.",
  invalid_pin: "PIN enam digit diperlukan.",
  pin_requires_approved_browser:
    "Gunakan PIN ini hanya dari peramban yang sudah disetujui.",
  pin_update_failed: "PIN peramban ini tidak dapat diperbarui.",
  current_password_required: "Kata sandi saat ini diperlukan.",
  setting_requires_approved_browser:
    "Gunakan pengaturan ini hanya dari peramban yang sudah disetujui.",
  current_password_invalid: "Kata sandi saat ini tidak dikenali.",
  pin_remove_failed: "PIN peramban ini tidak dapat dihapus.",
  image_required: "Pilih gambar untuk diunggah.",
  photo_type_invalid: "Pilih gambar JPEG, PNG, atau WebP.",
  account_not_found: "Akun tidak ditemukan.",
  profile_photo_update_failed: "Foto profil tidak dapat diperbarui.",
  profile_photo_remove_failed: "Foto profil tidak dapat dihapus.",
};
