#include "napi/matrix_ops.h"
#include <vector>
#include <cmath>
#include <algorithm>

namespace MatrixOps {
static std::vector<double> GetArray(napi_env env, napi_value val) {
    double *d=0; size_t l=0; napi_get_arraybuffer_info(env,val,(void**)&d,&l);
    return std::vector<double>(d,d+l/sizeof(double));
}
static napi_value MakeArray(napi_env env, const std::vector<double>& v) {
    napi_value r; void*b=0; napi_create_arraybuffer(env,v.size()*8,&b,&r);
    memcpy(b,v.data(),v.size()*8); return r;
}
napi_value Multiply(napi_env env, napi_callback_info info) {
    size_t argc=4; napi_value a[4]; napi_get_cb_info(env,info,&argc,a,0,0);
    auto A=GetArray(env,a[0]); auto B=GetArray(env,a[1]); int m=0,n=0;
    napi_get_value_int32(env,a[2],&m); napi_get_value_int32(env,a[3],&n);
    int k=A.size()/m; std::vector<double> C(m*n,0.0);
    for(int i=0;i<m;i++)for(int j=0;j<n;j++){double s=0;for(int p=0;p<k;p++)s+=A[i*k+p]*B[p*n+j];C[i*n+j]=s;}
    return MakeArray(env,C);
}
napi_value Transpose(napi_env env, napi_callback_info info) {
    size_t argc=3; napi_value a[3]; napi_get_cb_info(env,info,&argc,a,0,0);
    auto A=GetArray(env,a[0]); int r=0,c=0;
    napi_get_value_int32(env,a[1],&r); napi_get_value_int32(env,a[2],&c);
    std::vector<double> T(c*r); for(int i=0;i<r;i++)for(int j=0;j<c;j++)T[j*r+i]=A[i*c+j];
    return MakeArray(env,T);
}
napi_value SVD(napi_env env, napi_callback_info info) {
    size_t argc=3; napi_value a[3]; napi_get_cb_info(env,info,&argc,a,0,0);
    auto A=GetArray(env,a[0]); int m=0,n=0;
    napi_get_value_int32(env,a[1],&m); napi_get_value_int32(env,a[2],&n);
    auto B=A;
    for(int it=0;it<150;it++){bool c=true;for(int p=0;p<n;p++)for(int q=p+1;q<n;q++){
        double al=0,be=0,ga=0;for(int i=0;i<m;i++){al+=B[i*n+p]*B[i*n+p];be+=B[i*n+q]*B[i*n+q];ga+=B[i*n+p]*B[i*n+q];}
        if(std::abs(ga)<1e-14*std::sqrt(al*be))continue;c=false;
        double tau=(be-al)/(2.0*ga);double t=(tau>=0?1:-1)/(std::abs(tau)+std::sqrt(1+tau*tau));
        double c2=1/std::sqrt(1+t*t),s=t*c2;
        for(int i=0;i<m;i++){double bp=B[i*n+p],bq=B[i*n+q];B[i*n+p]=c2*bp-s*bq;B[i*n+q]=s*bp+c2*bq;}
    }if(c)break;}
    std::vector<double> sig(n);for(int j=0;j<n;j++){double s=0;for(int i=0;i<m;i++)s+=B[i*n+j]*B[i*n+j];sig[j]=std::sqrt(s);}
    std::sort(sig.rbegin(),sig.rend()); return MakeArray(env,sig);
}
napi_value Inverse(napi_env env, napi_callback_info info) {
    size_t argc=2; napi_value a[2]; napi_get_cb_info(env,info,&argc,a,0,0);
    auto A=GetArray(env,a[0]); int n=0; napi_get_value_int32(env,a[1],&n);
    std::vector<double> aug(n*2*n);
    for(int i=0;i<n;i++){for(int j=0;j<n;j++)aug[i*2*n+j]=A[i*n+j];aug[i*2*n+n+i]=1;}
    for(int c=0;c<n;c++){int mx=c;for(int r=c+1;r<n;r++)if(std::abs(aug[r*2*n+c])>std::abs(aug[mx*2*n+c]))mx=r;
    if(mx!=c)for(int j=0;j<2*n;j++)std::swap(aug[c*2*n+j],aug[mx*2*n+j]);
    double pv=aug[c*2*n+c];if(std::abs(pv)<1e-15)continue;
    for(int j=0;j<2*n;j++)aug[c*2*n+j]/=pv;
    for(int r=0;r<n;r++){if(r==c)continue;double f=aug[r*2*n+c];for(int j=0;j<2*n;j++)aug[r*2*n+j]-=f*aug[c*2*n+j];}}
    std::vector<double> res(n*n);for(int i=0;i<n;i++)for(int j=0;j<n;j++)res[i*n+j]=aug[i*2*n+n+j];
    return MakeArray(env,res);
}
napi_value Eigh(napi_env env, napi_callback_info info) {
    size_t argc=2; napi_value a[2]; napi_get_cb_info(env,info,&argc,a,0,0);
    auto A=GetArray(env,a[0]); int n=0; napi_get_value_int32(env,a[1],&n);
    auto T=A;
    for(int it=0;it<100*n;it++){double mx=0;int pi=0,qi=1;
    for(int i=0;i<n;i++)for(int j=i+1;j<n;j++)if(std::abs(T[i*n+j])>mx){mx=std::abs(T[i*n+j]);pi=i;qi=j;}
    if(mx<1e-14)break;
    double th=(T[pi*n+pi]==T[qi*n+qi])?M_PI/4:0.5*std::atan2(2*T[pi*n+qi],T[pi*n+pi]-T[qi*n+qi]);
    double c=std::cos(th),s=std::sin(th);
    for(int i=0;i<n;i++){double tp=T[i*n+pi],tq=T[i*n+qi];T[i*n+pi]=c*tp-s*tq;T[i*n+qi]=s*tp+c*tq;}
    for(int j=0;j<n;j++){double tp=T[pi*n+j],tq=T[qi*n+j];T[pi*n+j]=c*tp-s*tq;T[qi*n+j]=s*tp+c*tq;}}
    std::vector<double> ev(n);for(int i=0;i<n;i++)ev[i]=T[i*n+i];
    std::sort(ev.rbegin(),ev.rend()); return MakeArray(env,ev);
}
napi_value DistanceMatrix(napi_env env, napi_callback_info info) {
    size_t argc=4; napi_value a[4]; napi_get_cb_info(env,info,&argc,a,0,0);
    auto X=GetArray(env,a[0]); int n=0,p=0,mt=0;
    napi_get_value_int32(env,a[1],&n);napi_get_value_int32(env,a[2],&p);napi_get_value_int32(env,a[3],&mt);
    std::vector<double> D(n*n,0.0);
    for(int i=0;i<n;i++)for(int j=i+1;j<n;j++){double d=0;
    if(mt==1){double num=0,den=0;for(int k=0;k<p;k++){num+=std::abs(X[i*p+k]-X[j*p+k]);den+=X[i*p+k]+X[j*p+k];}d=den>0?num/den:0;}
    else{for(int k=0;k<p;k++)d+=(X[i*p+k]-X[j*p+k])*(X[i*p+k]-X[j*p+k]);d=std::sqrt(d);}
    D[i*n+j]=d;D[j*n+i]=d;}
    return MakeArray(env,D);
}
napi_value Clustering(napi_env env, napi_callback_info info) {
    size_t argc=3; napi_value a[3]; napi_get_cb_info(env,info,&argc,a,0,0);
    int n=0,nc=0; napi_get_value_int32(env,a[1],&n);napi_get_value_int32(env,a[2],&nc);
    std::vector<double> lb(n);for(int i=0;i<n;i++)lb[i]=std::min(i*nc/n,nc-1);
    return MakeArray(env,lb);
}
}
