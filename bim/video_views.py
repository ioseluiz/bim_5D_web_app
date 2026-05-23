import os
import subprocess
import tempfile

from django.http import HttpResponse, JsonResponse
from rest_framework.decorators import api_view, parser_classes
from rest_framework.parsers import MultiPartParser


@api_view(['POST'])
@parser_classes([MultiPartParser])
def convert_video_to_mp4(request):
    video_file = request.FILES.get('video')
    if not video_file:
        return JsonResponse({'error': 'No se encontró archivo de video.'}, status=400)

    tmp_in_path = ''
    tmp_out_path = ''
    try:
        with tempfile.NamedTemporaryFile(suffix='.webm', delete=False) as tmp_in:
            for chunk in video_file.chunks():
                tmp_in.write(chunk)
            tmp_in_path = tmp_in.name

        tmp_out_path = tmp_in_path[:-5] + '.mp4'

        result = subprocess.run(
            [
                'ffmpeg',
                '-i', tmp_in_path,
                '-c:v', 'libx264',
                '-preset', 'fast',
                '-crf', '23',
                '-movflags', '+faststart',
                '-an',          # sin audio (la animación no tiene audio)
                '-y',
                tmp_out_path,
            ],
            capture_output=True,
            timeout=300,
        )

        if result.returncode != 0:
            stderr = result.stderr.decode('utf-8', errors='replace')
            return JsonResponse({'error': f'FFmpeg falló: {stderr[-600:]}'}, status=500)

        with open(tmp_out_path, 'rb') as f:
            mp4_data = f.read()

        response = HttpResponse(mp4_data, content_type='video/mp4')
        response['Content-Disposition'] = 'attachment; filename="timeliner_export.mp4"'
        return response

    except subprocess.TimeoutExpired:
        return JsonResponse(
            {'error': 'La conversión excedió el tiempo límite (5 min).'},
            status=504,
        )
    except FileNotFoundError:
        return JsonResponse(
            {
                'error': (
                    'FFmpeg no está instalado en el servidor. '
                    'Instálalo con: winget install ffmpeg (Windows) '
                    'o apt install ffmpeg (Linux/WSL).'
                )
            },
            status=500,
        )
    finally:
        for path in (tmp_in_path, tmp_out_path):
            try:
                if path and os.path.exists(path):
                    os.unlink(path)
            except OSError:
                pass
