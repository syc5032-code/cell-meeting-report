import http.server
import socketserver
import socket
import webbrowser
import os

PORT = 8080

def get_all_ips():
    ips = []
    try:
        hostname = socket.gethostname()
        _, _, ip_list = socket.gethostbyname_ex(hostname)
        ips.extend([ip for ip in ip_list if not ip.startswith('127.')])
    except Exception:
        pass

    # 추가 소켓 감지
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        primary = s.getsockname()[0]
        s.close()
        if primary not in ips and not primary.startswith('127.'):
            ips.insert(0, primary)
    except Exception:
        pass

    # 192.168. 또는 172. 또는 10. 사설망 IP 우선 정렬
    ips.sort(key=lambda x: (0 if x.startswith(('192.168.', '10.', '172.')) else 1))

    if not ips:
        ips.append('127.0.0.1')
    return ips

def run_server():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    ips = get_all_ips()
    primary_ip = ips[0]

    Handler = http.server.SimpleHTTPRequestHandler

    # 듀얼 스택 또는 포트 재사용
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print("=" * 62)
        print("   📱 [송예찬 셀모임 보고서 작성기] 모바일 연동 서버 실행")
        print("=" * 62)
        print(f" * PC 접속 주소       : http://localhost:{PORT}")
        print("-" * 62)
        print(" * 핸드폰 접속 주소   : ")
        for idx, ip in enumerate(ips, 1):
            tag = "(추천 - 공유기/Wi-Fi)" if ip.startswith(('192.168.', '10.')) else ""
            print(f"   [{idx}] http://{ip}:{PORT}  {tag}")
        print("-" * 62)
        print(" [핸드폰으로 사용하는 초간단 방법]")
        print(" 1. 핸드폰을 컴퓨터와 '같은 Wi-Fi(공유기)'에 연결합니다.")
        print(f" 2. 핸드폰 브라우저(사파리/크롬) 주소창에 위 주소를 입력합니다.")
        print(f"    (가장 추천: http://{primary_ip}:{PORT} )")
        print(" 3. 브라우저 메뉴에서 [홈 화면에 추가]를 누르면 스마트폰 앱처럼 설치됩니다!")
        print("=" * 62)
        print(" * 종료하려면 이 창을 닫거나 Ctrl+C 를 누르세요.\n")

        # PC 기본 브라우저 자동 오픈
        webbrowser.open(f"http://localhost:{PORT}")

        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n서버를 안전하게 종료했습니다.")

if __name__ == '__main__':
    run_server()
