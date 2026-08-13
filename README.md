# ShortFlow Studio

Ứng dụng cá nhân quản lý quy trình sản xuất YouTube Shorts và theo dõi dữ liệu thật của nhiều kênh, tập trung vào viewer nước ngoài và tiến độ YouTube Partner Program.

## Chạy local

Yêu cầu Node.js 20 trở lên.

```bash
npm install
npm run dev
```

Mở địa chỉ Vite hiển thị trong terminal (thường là `http://localhost:5173`).

## Kết nối kênh YouTube thật

### 1. Tạo Google Cloud project

1. Mở [Google Cloud Console](https://console.cloud.google.com/).
2. Tạo project mới hoặc chọn project có sẵn.
3. Trong **APIs & Services → Library**, bật:
   - YouTube Data API v3
   - YouTube Analytics API
4. Mở **Google Auth Platform** và cấu hình OAuth consent screen.
5. Nếu ứng dụng ở trạng thái Testing, thêm chính email Google của bạn vào **Test users**.

### 2. Tạo OAuth Client

1. Vào **APIs & Services → Credentials**.
2. Chọn **Create credentials → OAuth client ID**.
3. Chọn loại **Web application**.
4. Thêm Authorized redirect URI chính xác:

```text
http://localhost:8787/api/auth/google/callback
```

### 3. Cấu hình local

Sao chép `.env.example` thành `.env` và điền thông tin vừa tạo:

```env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:8787/api/auth/google/callback
PORT=8787
APP_ORIGIN=http://localhost:5173
```

Chạy `npm run dev`, mở ứng dụng và nhấn **Kết nối với Google**. Hãy chọn tài khoản đang sở hữu kênh YouTube cần theo dõi.

### Thêm và chuyển nhiều kênh

- Nhấn dấu `+` cạnh **Kênh của bạn** hoặc nút **Thêm kênh** trong trang Kênh.
- Chọn tài khoản Google/kênh cần cấp quyền. Nếu OAuth app đang Testing, email đó phải nằm trong Test users.
- Nhấn tên kênh trong sidebar để chuyển dashboard. Các kênh đã kết nối được giữ đồng thời.
- Biểu tượng gỡ kết nối chỉ xóa token local của kênh đang được chọn, không ảnh hưởng các kênh khác.

Khi chỉ theo dõi dữ liệu, ứng dụng yêu cầu hai quyền đọc:

- `youtube.readonly`
- `yt-analytics.readonly`

Khi bạn mở **Đăng video**, ShortFlow mới xin thêm quyền `youtube.upload` riêng cho kênh được chọn. Không cần tạo lại OAuth Client.

Token được lưu cục bộ tại `.data/youtube-connections.json` và thư mục này đã nằm trong `.gitignore`. Backend chỉ lắng nghe trên `127.0.0.1`; không commit hoặc chia sẻ file `.env` và `.data`.

## Build production

```bash
npm run build
```

File production được tạo trong `dist/`.

## Kiểm tra chất lượng

```bash
npm run check
```

Lệnh này chạy ESLint, test tự động và production build. Có thể chạy `npm audit` để kiểm tra dependency.

## Các luồng đã hoạt động

- OAuth kết nối và chuyển đổi nhiều kênh YouTube thật.
- Dashboard dữ liệu Shorts 28 và 90 ngày.
- Thông tin kênh, subscriber và tổng lượt xem thật.
- Top video, lượt xem, engaged views, thời lượng xem và subscriber mang về.
- Viewer theo quốc gia để nghiên cứu thị trường nước ngoài.
- Pipeline năm bước: Ý tưởng → Kịch bản → Sản xuất → Kiểm duyệt → Đã lên lịch.
- Tạo Short mới và chọn kênh.
- Chuyển Short sang bước tiếp theo.
- Lịch đăng theo tuần.
- YPP Tracker ước tính theo mốc 1.000 subscriber và 10 triệu engaged views Shorts/90 ngày.
- Lưu nội dung pipeline bằng `localStorage`.
- Giao diện responsive cho desktop, tablet và điện thoại.
- Cache dashboard 60 giây để chuyển trang nhanh và giảm quota; nút đồng bộ luôn lấy dữ liệu mới.
- Upload MP4, MOV, WebM hoặc MKV vào hàng đợi; theo dõi tiến độ và mở kết quả trong YouTube Studio.
- Chọn `Private`, `Unlisted` hoặc `Public`; mặc định an toàn là `Private`, không thông báo subscriber và file tạm bị xóa khỏi máy sau khi xử lý.
- Lịch đăng đồng bộ các video đang có `publishAt` trực tiếp từ kênh YouTube được chọn; có chuyển tuần và đồng bộ thủ công.

## Đăng video

1. Chọn kênh trong sidebar rồi nhấn **Đăng video**.
2. Lần đầu, chọn **Cấp quyền qua Google** và đăng nhập đúng tài khoản/kênh đó.
3. Chọn file, nhập metadata, khai báo nội dung trẻ em/AI và xác nhận quyền sử dụng tài nguyên.
   - Chọn `Public` để công khai ngay.
   - Chọn `Scheduled` và ngày giờ Việt Nam (UTC+7) để hẹn công khai.
4. Nhấn **Upload Private**. Không đóng tiến trình backend cho tới khi hoàn tất.
5. Mở YouTube Studio để chờ YouTube xử lý, kiểm tra bản quyền và xác nhận lại lịch đăng.

Nếu Google Cloud project chưa được Google xác minh, video tải qua API có thể bị khóa ở chế độ Private cho đến khi project vượt qua API audit. Đây là giới hạn của YouTube, không phải lỗi của ShortFlow.

## Phạm vi MVP

Pipeline nội dung và lịch đăng vẫn là dữ liệu local do người dùng tự quản lý. Thông tin kênh và analytics được lấy trực tiếp từ YouTube APIs. Chỉ số YPP trong ứng dụng là ước tính; số **valid public Shorts views** tại tab Earn trong YouTube Studio mới là số chính thức để xét điều kiện.

## Hướng tích hợp tiếp theo

1. Đồng bộ audience retention chi tiết theo từng video.
2. Gợi ý thị trường/ngôn ngữ dựa trên quốc gia và hiệu suất nội dung.
3. Lập lịch public sau khi người dùng kiểm duyệt video.
4. Object storage cho video, thumbnail, subtitle và giấy phép tài nguyên.
5. Worker bền vững để tiếp tục upload sau khi khởi động lại máy.
