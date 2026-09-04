{{/* Tên gốc của chart (cho phép ghi đè). */}}
{{- define "ktx.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Tên đầy đủ: <release>-<chart>, cắt 63 ký tự theo giới hạn nhãn của Kubernetes. */}}
{{- define "ktx.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "ktx.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "ktx.labels" -}}
helm.sh/chart: {{ include "ktx.chart" . }}
{{ include "ktx.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "ktx.selectorLabels" -}}
app.kubernetes.io/name: {{ include "ktx.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "ktx.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "ktx.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/* Tên Secret đang dùng: Secret có sẵn (nếu khai báo) hoặc Secret do chart tạo. */}}
{{- define "ktx.secretName" -}}
{{- if .Values.existingSecret -}}
{{- .Values.existingSecret -}}
{{- else -}}
{{- include "ktx.fullname" . -}}
{{- end -}}
{{- end -}}
