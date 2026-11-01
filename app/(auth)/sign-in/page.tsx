'use client';
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import InputField from "@/components/forms/InputField";
import FooterLink from "@/components/forms/FooterLink";
import { signInWithEmail } from "@/lib/actions/auth.actions";
import { useRouter } from "next/navigation";

const SignIn = () => {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignInFormData>({
    defaultValues: {
      email: '',
      password: '',
    },
    mode: 'onBlur'
  });
  const onSubmit = async (data: SignInFormData) => { 
    try {
      const result = await signInWithEmail(data);
      if (result.success) {
        router.push('/');
      }
    } catch (error) {
      console.error('Error submitting form:', error);
    }
  }
  return (
    <>
      <h1 className="form-title">Sign In</h1>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        <InputField
          name="email"
          label="Email"
          placeholder="contact@jsmastery.com"
          register={register}
          error={errors.email}
          validation={{ required: 'Email name is required', pattern: /^\w+@\w+\.\w+$/, message: 'Email address is required' }}
        />
        <InputField
          name="password"
          label="Password"
          placeholder="Enter your password"
          type="password"
          register={register}
          error={errors.password}
          validation={{ required: 'Password is required', minLength: 8 }}
        />
        <Button type="submit" className="yellow-btn w-full mt-5" disabled={isSubmitting}>
          {isSubmitting ? 'Signing In...' : 'Sign In'}
        </Button>

        <FooterLink text="Don't have an account?" linkText="Sign Up" href="/sign-up" />
      </form>
    </>
  )
}

export default SignIn
