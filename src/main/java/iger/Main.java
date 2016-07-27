package iger;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.List;
import java.util.stream.Collectors;

import org.eclipse.jgit.api.Git;
import org.eclipse.jgit.api.errors.GitAPIException;
import org.eclipse.jgit.api.errors.InvalidRemoteException;
import org.eclipse.jgit.api.errors.TransportException;

import com.amazonaws.auth.AWSCredentials;
import com.amazonaws.auth.DefaultAWSCredentialsProviderChain;
import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.s3.AmazonS3;
import com.amazonaws.services.s3.AmazonS3Client;
import com.amazonaws.services.s3.model.DeleteObjectsRequest;
import com.amazonaws.services.s3.model.DeleteObjectsRequest.KeyVersion;
import com.amazonaws.services.s3.transfer.MultipleFileUpload;
import com.amazonaws.services.s3.transfer.TransferManager;

public class Main {
	
	private static String FHIR_IG_BUILDER_URL = "http://hl7-fhir.github.io/org.hl7.fhir.igpublisher.jar";

	public static void run(File fromDir, String... args) throws Exception {
		ProcessBuilder p = (new ProcessBuilder()).directory(fromDir). command(args).inheritIO();
		p.environment().put("PATH", p.environment().get("PATH").concat(":/var/task/bin:/var/task/ruby/bin"));
		p.start().waitFor();
	}

	public static String tempDir() throws IOException {
		return Files.createTempDirectory("tempfiles").toAbsolutePath().toString();
	}

	public static String build(Req req, Context context) throws Exception {
		String cloneDir = tempDir();

		File jarFile = File.createTempFile("builder", "jar");
		
		if (!req.getService().equals("github.com")){
			throw new Exception(String.format("Please use a 'github.com' repo, not '%1$s'", req.getService()));
		}
		
		URL website = new URL(FHIR_IG_BUILDER_URL);
		try (InputStream in = website.openStream()) {
		    Files.copy(in, jarFile.toPath(), StandardCopyOption.REPLACE_EXISTING);
		}
		
		String source = String.format("https://%1$s/%2$s/%3$s", req.getService(), req.getOrg(), req.getRepo());
		AWSCredentials creds = new DefaultAWSCredentialsProviderChain().getCredentials();
		AmazonS3 s3 = new AmazonS3Client(creds);
		TransferManager tx = new TransferManager(creds);
		
		String path = String.format("%1$s/%2$s", req.getOrg(), req.getRepo());

		System.out.println("Cloning repo " + source);
		cloneRepo(cloneDir, source);
		
		System.out.println("Building docs");
		buildDocs(jarFile, cloneDir);
		
		System.out.println("Deleting existing objects");
		clearBucket(req, s3, path);
		
		System.out.println("Uploading");
		uploadToBucket(path, req.getTarget(), cloneDir, tx);

		return "Published to: " + "https://ig.fhir.org.s3-website-us-east-1.amazonaws.com/" + req.getOrg() + "/" + req.getRepo();
	}

	private static void clearBucket(Req req, AmazonS3 s3, String path) {
		List<KeyVersion> keys = s3.listObjects(req.getTarget(), path)
				.getObjectSummaries()
				.stream()
				.map(i -> new KeyVersion(i.getKey()))
				.collect(Collectors.toList());
		
		if (keys.size() > 0) {
			s3.deleteObjects(
					new DeleteObjectsRequest(req.getTarget())
					.withKeys(keys));
		}
	}

	private static void buildDocs(File jarFile, String igClone) throws Exception {
		String igJson = new File(igClone, "ig.json").toPath().toAbsolutePath().toString();
		run(new File(igClone), "java", "-jar", jarFile.getAbsolutePath().toString(), "-ig", igJson);
		run(new File(igClone), "/var/task/bin/build-index.sh");
	}

	private static void cloneRepo(String igClone, String source)
			throws GitAPIException, InvalidRemoteException, TransportException {
		   Git.cloneRepository()
		  .setURI(source)
		  .setDirectory(new File(igClone))
		  .call();
	}

	private static void uploadToBucket(String path, String bucket, String buildDir, TransferManager tx) throws InterruptedException {
		MultipleFileUpload myUpload = tx.uploadDirectory(bucket, path, new File(buildDir), true);
		myUpload.waitForCompletion();
		tx.shutdownNow();
	}

	public static void main(String[] args) throws Exception {
		System.out.println("Starting main");
		Req req = new Req();
		req.setService("github.com");
		req.setOrg("test-igs");
		req.setRepo("simple");
		req.setTarget("ig.fhir.org");
		build(req, null);
		System.out.println("Finishing main");
	}

}