FROM python:3.11-slim
ARG BUILD_NAME=old
ARG FAIL_START=0
ENV APP_COMMIT=${BUILD_NAME}
ENV FAIL_START=${FAIL_START}
LABEL io.gaps.updater.protocol="1"
COPY server.py /server.py
EXPOSE 4277
CMD ["python", "/server.py"]
