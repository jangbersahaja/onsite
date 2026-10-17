import type { enErrors } from "../en/errors";

export const msErrors: typeof enErrors = {
  auth_unconfigured: "Pengesahan belum dikonfigurasi.",
  invalid_json: "Badan permintaan mesti JSON yang sah.",
  invalid_sign_in: "Nama pengguna/e-mel dan kata laluan diperlukan.",
  too_many_attempts: "Terlalu banyak cubaan log masuk. Cuba lagi kemudian.",
  invalid_credentials: "Nama pengguna/e-mel atau kata laluan tidak dikenali.",
  pending_approval:
    "Akaun anda sedang menunggu kelulusan admin. Sila hubungi penyelia/pengurus anda untuk meluluskan pendaftaran.",
  pin_not_recognized: "Log masuk PIN tidak dikenali untuk peranti ini.",
  password_mismatch: "Kata laluan tidak sepadan.",
  photo_required: "Foto profil diperlukan.",
  photo_too_large: "Foto profil mesti 2 MB atau kurang.",
  register_failed: "Pendaftaran ini tidak dapat dihantar.",
  registration_link_invalid: "Pautan pendaftaran ini tidak tersedia.",
  registration_link_missing: "Pautan pendaftaran ini tiada tokennya.",
  reset_link_invalid:
    "Pautan tetapan semula ini tidak sah, telah tamat tempoh, atau telah digunakan.",
  reset_link_incomplete:
    "Pautan tetapan semula ini tidak sah atau tidak lengkap.",
  sign_in_failed: "Log masuk gagal.",
  pin_sign_in_unconfigured:
    "Log masuk PIN belum dikonfigurasi pada pelayan ini.",
  invalid_pin_sign_in: "Akaun yang sah dan PIN enam digit diperlukan.",
  pin_sign_in_failed: "Tidak dapat log masuk dengan PIN.",
  unauthorized: "Log masuk untuk teruskan.",
  invalid_locale: "Pilih bahasa yang disokong.",
  email_taken: "Akaun dengan e-mel ini sudah wujud.",
  username_taken: "Nama pengguna ini sudah digunakan.",
  registration_rate_limited:
    "Terlalu banyak cubaan pendaftaran. Cuba lagi kemudian.",
  invalid_registration:
    "Nama, nama pengguna, e-mel, kata laluan sekurang-kurangnya 12 aksara, dan pautan yang sah diperlukan.",
  photo_invalid: "Foto profil tidak dapat disahkan.",
  clock_unconfigured: "Tetapkan DATABASE_URL sebelum menggunakan fungsi jam.",
  clock_access_disabled: "Akses jam tidak diaktifkan.",
  invalid_history_filters: "Penapis tarikh sejarah tidak sah.",
  invalid_history_pagination: "Penomboran sejarah tidak sah.",
  timekeeping_load_failed: "Data masa kerja tidak dapat dimuatkan.",
  invalid_clock_action: "Butiran tindakan jam tidak sah.",
  no_open_shift: "Tiada shif terbuka di outlet ini.",
  break_already_open: "Shif ini sudah mempunyai rehat yang terbuka.",
  no_open_break: "Shif ini tiada rehat terbuka untuk ditamatkan.",
  outlet_not_assigned: "Anda tidak ditugaskan ke outlet ini.",
  staff_device_not_approved:
    "Peranti ini tidak diluluskan untuk tindakan jam kakitangan.",
  location_accuracy_low:
    "Ketepatan lokasi terlalu rendah. Minta pembetulan masa secara manual daripada ketua outlet anda.",
  outside_clock_radius:
    "Anda tidak dapat disahkan dalam radius jam outlet ini. Minta pembetulan masa secara manual jika perlu.",
  outlet_not_found: "Outlet tidak ditemui.",
  already_clocked_in: "Anda sudah mempunyai shif yang terbuka.",
  end_break_first: "Tamatkan rehat anda sebelum daftar keluar.",
  clock_action_failed: "Tindakan jam tidak dapat direkodkan.",
  corrections_unconfigured:
    "Tetapkan DATABASE_URL sebelum menggunakan pembetulan.",
  correction_review_unavailable: "Akses semakan pembetulan tidak tersedia.",
  outlet_access_denied: "Anda tidak boleh mengakses outlet ini.",
  corrections_load_failed: "Permintaan pembetulan tidak dapat dimuatkan.",
  invalid_decision: "Butiran keputusan tidak sah.",
  correction_not_found: "Pembetulan yang digunakan tidak ditemui.",
  related_shift_missing: "Shif berkaitan tidak lagi wujud.",
  future_time_reconcile: "Masa akan datang tidak boleh diselaraskan.",
  adjusted_punch_out_of_order:
    "Catatan masa yang diselaraskan akan menyebabkan shif tidak tersusun.",
  adjusted_clock_in_overlaps:
    "Masa masuk yang diselaraskan bertindih dengan shif lain.",
  correction_not_awaiting: "Pembetulan ini tidak lagi menunggu penyelarasan.",
  correction_review_failed: "Permintaan pembetulan tidak dapat disemak.",
  invalid_correction: "Butiran permintaan pembetulan tidak sah.",
  clock_out_shift_required:
    "Pilih shif yang memerlukan pembetulan daftar keluar.",
  requested_time_future: "Masa yang diminta tidak boleh pada masa hadapan.",
  shift_not_owned: "Shif itu bukan milik akaun anda.",
  break_not_found: "Rehat itu tidak lagi wujud pada shif ini.",
  break_end_locked:
    "Rehat yang masih terbuka hanya boleh dibetulkan masa mulanya.",
  break_in_future: "Masa rehat tidak boleh pada masa hadapan.",
  break_invalid:
    "Masa rehat mesti berada dalam shif dan tidak boleh bertindih dengan rehat lain.",
  break_shift_required: "Pilih shif yang mengandungi rehat itu.",
  break_not_adjustable: "Rehat yang dipadam hanya boleh disahkan.",
  requested_punch_out_of_order:
    "Catatan masa yang diminta akan menyebabkan shif tidak tersusun.",
  requested_clock_in_overlaps:
    "Masa masuk yang diminta bertindih dengan shif lain.",
  shift_update_failed: "Shif tidak dapat dikemas kini.",
  correction_submit_failed: "Permintaan pembetulan tidak dapat dihantar.",
  device_review_unavailable: "Akses semakan peranti tidak tersedia.",
  outlet_not_available: "Outlet tidak tersedia.",
  device_status_failed: "Status peranti yang dipercayai tidak dapat dimuatkan.",
  device_request_pending:
    "Permintaan peranti sudah menunggu kelulusan pengurus.",
  device_request_failed:
    "Permintaan peranti yang dipercayai tidak dapat dihantar.",
  team_access_denied: "Akses pasukan ditolak.",
  invalid_device_action: "Tindakan peranti yang sah diperlukan.",
  device_manage_denied: "Anda tidak boleh mengurus peranti ini.",
  own_device_manage_denied:
    "Anda tidak boleh mengurus peranti dipercayai anda sendiri.",
  approve_requires_pending: "Hanya peranti yang menunggu boleh diluluskan.",
  reject_requires_pending: "Hanya peranti yang menunggu boleh ditolak.",
  revoke_requires_active: "Hanya peranti aktif boleh dibatalkan.",
  device_status_changed:
    "Status peranti telah berubah. Muat semula dan cuba lagi.",
  device_update_failed: "Peranti yang dipercayai tidak dapat dikemas kini.",
  invalid_pin: "PIN enam digit diperlukan.",
  pin_requires_approved_browser:
    "Gunakan PIN ini hanya daripada peranti yang diluluskan.",
  pin_update_failed: "PIN peranti ini tidak dapat dikemas kini.",
  current_password_required: "Kata laluan semasa diperlukan.",
  setting_requires_approved_browser:
    "Gunakan tetapan ini hanya daripada peranti yang diluluskan.",
  current_password_invalid: "Kata laluan semasa tidak dikenali.",
  pin_remove_failed: "PIN peranti ini tidak dapat dibuang.",
  image_required: "Pilih imej untuk dimuat naik.",
  photo_type_invalid: "Pilih imej JPEG, PNG, atau WebP.",
  account_not_found: "Akaun tidak ditemui.",
  profile_photo_update_failed: "Foto profil tidak dapat dikemas kini.",
  profile_photo_remove_failed: "Foto profil tidak dapat dibuang.",
};
